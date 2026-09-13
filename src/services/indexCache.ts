import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { contextContainer } from '../context';
import { mapWithConcurrency } from '../util/common';

export interface IndexCacheSpec {
    folder: string;
    extension: string;
    layer: 'global' | 'workspace' | 'all';
}

export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

export async function indexFingerprint(spec: IndexCacheSpec, signal: AbortSignal): Promise<string> {
    const { getFilePathFromModOrHOI4, listFilesFromModOrHOI4, expiryToken, readFileFromPath, isHoiFileOpened } = require('../util/fileloader') as typeof import('../util/fileloader');
    const config = vscode.workspace.getConfiguration('hoi4ModUtilities');
    const layers = spec.layer === 'global' ? [{ mod: false, hoi4: true, dlc: false }, { mod: false, hoi4: false, dlc: true }]
        : spec.layer === 'workspace' ? [{ mod: true, hoi4: false, dlc: false }] : [{}];
    const entries: string[] = [];
    for (const options of layers) {
        signal.throwIfAborted();
        const files = (await listFilesFromModOrHOI4(spec.folder, { ...options, recursively: true }))
            .filter(file => file.toLowerCase().endsWith(spec.extension)).sort();
        entries.push(...await mapWithConcurrency(files, 8, async file => {
            signal.throwIfAborted();
            const uri = await getFilePathFromModOrHOI4(`${spec.folder}/${file}`, options);
            const version = uri && isHoiFileOpened(uri) ? digest((await readFileFromPath(uri))[0].toString()) : await expiryToken(uri);
            return JSON.stringify([options, file, uri?.toString(), version]);
        }));
    }
    return digest(JSON.stringify([spec, config.installPath, config.loadDlcContents, config.modFile, config.previewLocalisation,
        vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()), entries]));
}

export function indexCacheUri(name: string): vscode.Uri | undefined {
    const root = contextContainer.current?.globalStorageUri;
    if (!root) { return undefined; }
    const config = vscode.workspace.getConfiguration('hoi4ModUtilities');
    const namespace = JSON.stringify([name, config.installPath, config.modFile, config.loadDlcContents,
        config.previewLocalisation, vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString())]);
    return vscode.Uri.joinPath(root, 'indexes-v1', `${digest(namespace)}.json`);
}

export async function readIndexCache<T>(uri: vscode.Uri, fingerprint: string): Promise<T | undefined> {
    try {
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > 64 * 1024 * 1024) { return undefined; }
        const envelope = JSON.parse(Buffer.from(await vscode.workspace.fs.readFile(uri)).toString());
        if (envelope.version !== 1 || envelope.fingerprint !== fingerprint || typeof envelope.data !== 'string'
            || digest(envelope.data) !== envelope.checksum) { return undefined; }
        const result = JSON.parse(envelope.data);
        return result && typeof result === 'object' && !Array.isArray(result) ? result as T : undefined;
    } catch { return undefined; }
}

export async function saveIndexCache(uri: vscode.Uri, fingerprint: string, value: unknown, signal: AbortSignal): Promise<void> {
    const temp = uri.with({ path: uri.path + '.' + randomUUID() + '.tmp' });
    try {
        signal.throwIfAborted();
        const data = JSON.stringify(value);
        if (Buffer.byteLength(data) > 60 * 1024 * 1024) { return; }
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
        await vscode.workspace.fs.writeFile(temp, Buffer.from(JSON.stringify({ version: 1, fingerprint, data, checksum: digest(data) })));
        signal.throwIfAborted();
        await vscode.workspace.fs.rename(temp, uri, { overwrite: true });
    } catch { /* A cache failure must not prevent an in-memory preview. */ }
    finally { try { await vscode.workspace.fs.delete(temp); } catch { /* Already renamed or absent. */ } }
}
