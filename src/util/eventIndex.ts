import { IndexService } from '../services/indexService';
import { getFileContentSourceGeneration, getFilePathFromMod, listFilesFromModOrHOI4, readFileFromModOrHOI4 } from './fileloader';
import { parseHoi4File } from '../hoiformat/hoiparser';
import { getEvents } from '../previewdef/event/schema';
import { mapWithConcurrency } from './common';
import * as vscode from 'vscode';
import { getSelectedModSourceGeneration, onDidChangeSelectedModSource } from './modfile';

let indexedFiles: Record<string, string> = Object.create(null);
let sourceGeneration = '';
const service = new IndexService<{ index: Record<string, string> }>({
    events: {
        cache: { folder: 'events', extension: '.txt', layer: 'all' },
        statusMessage: 'Building event index...',
        telemetryEvent: 'eventIndex',
        reset: () => { indexedFiles = Object.create(null); },
        commit: snapshot => { indexedFiles = snapshot.index; },
        build: async (size, signal) => {
            const paths = (await listFilesFromModOrHOI4('events', { recursively: true }))
                .filter(file => file.toLowerCase().endsWith('.txt')).sort();
            const rows = await mapWithConcurrency(paths, 8, async relative => {
                signal.throwIfAborted();
                const file = `events/${relative}`;
                try {
                    const [content] = await readFileFromModOrHOI4(file);
                    size[0] += content.length;
                    return { file, mod: !!await getFilePathFromMod(file), events: Object.values(getEvents(parseHoi4File(content.toString()), file).eventItemsByNamespace).flat() };
                } catch { return { file, mod: false, events: [] }; }
            });
            const index: Record<string, string> = Object.create(null);
            rows.sort((a, b) => Number(b.mod) - Number(a.mod) || a.file.localeCompare(b.file));
            for (const row of rows) { for (const event of row.events) { index[event.id] ??= row.file; } }
            return { index };
        },
    },
});

export async function findEventFiles(ids: string[]): Promise<string[]> {
    if (!ids.length) { return []; }
    const generation = `${getFileContentSourceGeneration()}:${getSelectedModSourceGeneration()}`;
    if (sourceGeneration !== generation) { service.invalidate('events'); sourceGeneration = generation; }
    await service.ensure('events');
    return [...new Set(ids.map(id => indexedFiles[id]).filter(file => typeof file === 'string'))];
}

export function invalidateEventIndex(): void { service.invalidate('events'); }

export function registerEventIndex(): vscode.Disposable {
    const changed = (document: vscode.TextDocument) => {
        if (/\/events\/.*\.txt$/i.test(document.uri.path)) { invalidateEventIndex(); }
    };
    return vscode.Disposable.from(
        vscode.workspace.onDidOpenTextDocument(changed),
        vscode.workspace.onDidChangeTextDocument(event => changed(event.document)),
        vscode.workspace.onDidCloseTextDocument(changed),
        vscode.workspace.onDidChangeWorkspaceFolders(invalidateEventIndex),
        onDidChangeSelectedModSource(invalidateEventIndex),
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('hoi4ModUtilities')) { invalidateEventIndex(); }
        }),
        { dispose: invalidateEventIndex },
    );
}
