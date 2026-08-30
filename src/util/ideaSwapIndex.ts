import * as vscode from 'vscode';
import { Node, NodeValue, parseHoi4File } from '../hoiformat/hoiparser';
import { isIdeaSwapIndexEnabled } from './featureflags';
import { listFilesFromModOrHOI4, readFileFromModOrHOI4 } from './fileloader';

export interface IdeaSwap {
    from: string;
    to: string;
    file: string;
    start: number;
    end: number;
}

interface SwapRecord {
    from: string;
    to: string;
    start: number;
    end: number;
}

const swapRoots = ['common', 'events'];
let cachedSwaps: IdeaSwap[] | undefined;
let buildPromise: Promise<IdeaSwap[]> | undefined;

export function extractIdeaSwaps(node: Node): SwapRecord[] {
    const result: SwapRecord[] = [];
    walk(node);
    return result;

    function walk(current: Node): void {
        if (!Array.isArray(current.value)) {
            return;
        }
        for (const child of current.value) {
            if (child.name?.toLowerCase() === 'swap_ideas') {
                readSwapBlock(child, result);
            } else {
                walk(child);
            }
        }
    }
}

export async function getIdeaSwaps(ideaIds: string[]): Promise<IdeaSwap[]> {
    if (!isIdeaSwapIndexEnabled() || ideaIds.length === 0) {
        return [];
    }

    const swaps = await ensureBuilt();
    const byIdea = new Map<string, IdeaSwap[]>();
    for (const swap of swaps) {
        addToLookup(byIdea, swap.from, swap);
        addToLookup(byIdea, swap.to, swap);
    }

    const seen = new Set<string>();
    const found = new Map<string, IdeaSwap>();
    const queue = [...ideaIds];
    let budget = 1000;
    while (queue.length > 0 && budget-- > 0) {
        const id = queue.shift();
        if (!id || seen.has(id)) {
            continue;
        }
        seen.add(id);
        for (const swap of byIdea.get(id) ?? []) {
            const key = `${swap.from}\0${swap.to}\0${swap.file}\0${swap.start}`;
            if (!found.has(key)) {
                found.set(key, swap);
                queue.push(swap.from, swap.to);
            }
        }
    }

    return [...found.values()].sort((left, right) =>
        left.from.localeCompare(right.from)
        || left.to.localeCompare(right.to)
        || left.file.localeCompare(right.file)
        || left.start - right.start);
}

export function registerIdeaSwapIndex(): vscode.Disposable {
    if (!isIdeaSwapIndexEnabled()) {
        return new vscode.Disposable(() => undefined);
    }
    const watcher = vscode.workspace.createFileSystemWatcher('**/{common,events}/**/*.txt');
    const invalidate = () => {
        cachedSwaps = undefined;
        buildPromise = undefined;
    };
    return vscode.Disposable.from(
        watcher,
        watcher.onDidCreate(invalidate),
        watcher.onDidChange(invalidate),
        watcher.onDidDelete(invalidate),
        vscode.workspace.onDidChangeWorkspaceFolders(invalidate),
    );
}

function ensureBuilt(): Promise<IdeaSwap[]> {
    if (cachedSwaps) {
        return Promise.resolve(cachedSwaps);
    }
    buildPromise ??= buildSwapIndex().then(swaps => {
        cachedSwaps = swaps;
        return swaps;
    }).finally(() => {
        buildPromise = undefined;
    });
    return buildPromise;
}

async function buildSwapIndex(): Promise<IdeaSwap[]> {
    const result: IdeaSwap[] = [];
    for (const root of swapRoots) {
        let files: string[] = [];
        try {
            files = await listFilesFromModOrHOI4(root, { recursively: true });
        } catch {
            continue;
        }
        for (const relative of files.filter(file => file.toLowerCase().endsWith('.txt'))) {
            const file = `${root}/${relative}`.replace(/\\/g, '/');
            try {
                const [buffer] = await readFileFromModOrHOI4(file);
                const content = buffer.toString();
                if (!content.includes('swap_ideas')) {
                    continue;
                }
                result.push(...extractIdeaSwaps(parseHoi4File(content)).map(record => ({ ...record, file })));
            } catch {
                // A single malformed or unavailable file must not invalidate all usable chains.
            }
        }
    }
    return result;
}

function readSwapBlock(node: Node, into: SwapRecord[]): void {
    if (!Array.isArray(node.value)) {
        return;
    }
    const removed: string[] = [];
    const added: string[] = [];
    for (const child of node.value) {
        const value = symbolName(child.value);
        if (value === undefined) {
            continue;
        }
        if (child.name?.toLowerCase() === 'remove_idea') {
            removed.push(value);
        } else if (child.name?.toLowerCase() === 'add_idea') {
            added.push(value);
        }
    }
    const start = node.nameToken?.start ?? 0;
    const end = node.valueEndToken?.end ?? node.nameToken?.end ?? start;
    if (removed.length === added.length) {
        removed.forEach((from, index) => pushSwap(into, from, added[index], start, end));
    } else {
        removed.forEach(from => added.forEach(to => pushSwap(into, from, to, start, end)));
    }
}

function pushSwap(into: SwapRecord[], from: string | undefined, to: string | undefined, start: number, end: number): void {
    if (from && to && from !== to) {
        into.push({ from, to, start, end });
    }
}

function symbolName(value: NodeValue): string | undefined {
    if (typeof value === 'string') {
        return value;
    }
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value.name : undefined;
}

function addToLookup(map: Map<string, IdeaSwap[]>, key: string, swap: IdeaSwap): void {
    map.set(key, [...(map.get(key) ?? []), swap]);
}
