import * as vscode from 'vscode';
import { createHash, randomUUID } from 'crypto';
import { contextContainer } from '../context';
import { mapWithConcurrency } from '../util/common';
import { serializeIndex } from './indexSerialization';
import { maxIndexCacheBytes } from './indexSerializationProtocol';

export interface IndexCacheSpec {
    folder: string;
    extension: string;
    layer: 'global' | 'workspace' | 'all';
    /**
     * Filters paths relative to folder before URI resolution and version reads.
     * Must match the builder's inputs. A getter can capture a configuration snapshot;
     * it is read once per fingerprint. The predicate itself is not serialized, so
     * selector settings must be covered by the cache namespace/fingerprint config.
     */
    includeFile?: (file: string) => boolean;
}

export const digest = (text: string): string => createHash('sha256').update(text).digest('hex');

export async function indexFingerprint(spec: IndexCacheSpec, signal: AbortSignal): Promise<string> {
    const { getFilePathFromModOrHOI4, listFilesFromModOrHOI4, expiryToken, readFileFromPath, isHoiFileOpened } = require('../util/fileloader') as typeof import('../util/fileloader');
    const config = vscode.workspace.getConfiguration('hoi4ModUtilities');
    const { includeFile, ...fingerprintSpec } = spec;
    const layers = spec.layer === 'global' ? [{ mod: false, hoi4: true, dlc: false }, { mod: false, hoi4: false, dlc: true }]
        : spec.layer === 'workspace' ? [{ mod: true, hoi4: false, dlc: false }] : [{}];
    const entries: string[] = [];
    for (const options of layers) {
        signal.throwIfAborted();
        const files = (await listFilesFromModOrHOI4(spec.folder, { ...options, recursively: true }))
            .filter(file => file.toLowerCase().endsWith(spec.extension) && (!includeFile || includeFile(file))).sort();
        entries.push(...await mapWithConcurrency(files, 8, async file => {
            signal.throwIfAborted();
            const uri = await getFilePathFromModOrHOI4(`${spec.folder}/${file}`, options);
            const version = uri && isHoiFileOpened(uri) ? digest((await readFileFromPath(uri, undefined, { priority: 'background' }))[0].toString()) : await expiryToken(uri);
            return JSON.stringify([options, file, uri?.toString(), version]);
        }));
    }
    return digest(JSON.stringify([fingerprintSpec, config.installPath, config.loadDlcContents, config.modFile, config.previewLocalisation,
        vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString()), entries]));
}

export function indexCacheUri(name: string): vscode.Uri | undefined {
    const root = contextContainer.current?.globalStorageUri;
    if (!root) { return undefined; }
    const config = vscode.workspace.getConfiguration('hoi4ModUtilities');
    const namespace = JSON.stringify([name, config.installPath, config.modFile, config.loadDlcContents,
        config.previewLocalisation, vscode.workspace.workspaceFolders?.map(folder => folder.uri.toString())]);
    return vscode.Uri.joinPath(root, 'indexes-v2', `${digest(namespace)}.cache`);
}

export async function readIndexCache(uri: vscode.Uri, fingerprint: string, signal?: AbortSignal): Promise<unknown> {
    try {
        signal?.throwIfAborted();
        const stat = await vscode.workspace.fs.stat(uri);
        if (stat.size > maxIndexCacheBytes) { return undefined; }
        const bytes = await vscode.workspace.fs.readFile(uri);
        signal?.throwIfAborted();
        if (bytes.byteLength > maxIndexCacheBytes) { return undefined; }
        const result = await serializeIndex({ kind: 'decode', fingerprint, bytes }, signal);
        return result?.kind === 'decode' ? result.value : undefined;
    } catch { signal?.throwIfAborted(); return undefined; }
}

interface CacheSave {
    controller: AbortController;
    promise: Promise<void>;
    value?: unknown;
}
const cacheSaves = new Map<string, CacheSave>();

export function saveIndexCache(uri: vscode.Uri, fingerprint: string, value: unknown, signal: AbortSignal): Promise<void> {
    const key = uri.toString();
    const previous = cacheSaves.get(key);
    previous?.controller.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) { controller.abort(); }
    const save: CacheSave = { controller, promise: Promise.resolve(), value };
    value = undefined;
    const releaseSnapshot = () => { save.value = undefined; };
    controller.signal.addEventListener('abort', releaseSnapshot, { once: true });
    if (controller.signal.aborted) { releaseSnapshot(); }
    // Serialize publication for each disk target, including an already-started rename:
    // a superseded write can never complete after a newer snapshot's rename.
    save.promise = (async () => {
        await previous?.promise;
        const temp = uri.with({ path: uri.path + '.' + randomUUID() + '.tmp' });
        let published = false;
        try {
            controller.signal.throwIfAborted();
            const result = await serializeIndex({ kind: 'encode', fingerprint, value: save.value }, controller.signal);
            save.value = undefined;
            controller.signal.throwIfAborted();
            if (result?.kind !== 'encode') { return; }
            await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
            controller.signal.throwIfAborted();
            await vscode.workspace.fs.writeFile(temp, result.bytes);
            controller.signal.throwIfAborted();
            await vscode.workspace.fs.rename(temp, uri, { overwrite: true });
            published = true;
        } catch { /* Cache failure and cancellation never prevent an in-memory preview. */ }
        finally {
            try { await vscode.workspace.fs.delete(temp); } catch { /* Renamed or absent. */ }
            if (published && controller.signal.aborted) {
                // Rename itself is not cancellable. Retire its stale result before releasing
                // the per-URI publication lane; a newer rename cannot have run yet.
                try { await vscode.workspace.fs.delete(uri); } catch { /* Storage remains best effort. */ }
            }
        }
    })().catch(() => { /* Includes a failed predecessor or unavailable storage URI. */ }).finally(() => {
        save.value = undefined;
        controller.signal.removeEventListener('abort', releaseSnapshot);
        signal.removeEventListener('abort', abort);
        if (cacheSaves.get(key) === save) { cacheSaves.delete(key); }
    });
    cacheSaves.set(key, save);
    return save.promise;
}
