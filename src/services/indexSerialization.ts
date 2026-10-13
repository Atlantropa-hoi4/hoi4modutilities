import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import {
    indexCloneSize, isIndexFingerprint, maxIndexCacheBytes, maxIndexCloneBytes,
} from './indexSerializationProtocol';
import type { IndexSerializationInput, IndexSerializationReply, IndexSerializationResult } from './indexSerializationProtocol';

interface SerializationTask {
    id: number;
    input: IndexSerializationInput;
    size: number;
    signal?: AbortSignal;
    abort(): void;
    resolve(result: IndexSerializationResult | undefined): void;
    reject(error: Error): void;
    timer?: NodeJS.Timeout;
}

export class IndexSerializationService {
    private worker?: Worker;
    private stopping?: Promise<void>;
    private active?: SerializationTask;
    private readonly queue: SerializationTask[] = [];
    private queuedBytes = 0;
    private nextId = 1;
    private idleTimer?: NodeJS.Timeout;
    private disposed = false;

    constructor(private readonly options: { workerPath: string; timeoutMs?: number; idleTimeoutMs?: number }) {}

    public run(input: IndexSerializationInput, signal?: AbortSignal): Promise<IndexSerializationResult | undefined> {
        if (signal?.aborted || this.disposed) { return Promise.reject(serializationAbortError()); }
        if (!isIndexFingerprint(input.fingerprint) || this.queue.length >= 2) { return Promise.resolve(undefined); }
        let size: number | undefined;
        try {
            size = input.kind === 'encode' ? indexCloneSize(input.value)
                : input.bytes instanceof Uint8Array && input.bytes.byteLength <= maxIndexCacheBytes ? input.bytes.byteLength : undefined;
        } catch { return Promise.resolve(undefined); }
        if (size === undefined || size + this.queuedBytes + (this.active?.size ?? 0) > maxIndexCloneBytes) {
            return Promise.resolve(undefined);
        }
        return new Promise((resolve, reject) => {
            const task: SerializationTask = { id: this.nextId++, input, size, signal, resolve, reject,
                abort: () => this.cancel(task) };
            this.queue.push(task);
            this.queuedBytes += size;
            signal?.addEventListener('abort', task.abort, { once: true });
            if (signal?.aborted) { this.cancel(task); } else { this.pump(); }
        });
    }

    public dispose(): void {
        this.disposed = true;
        this.finishAll(serializationAbortError());
    }

    private pump(): void {
        if (this.disposed || this.active || this.stopping) { return; }
        const task = this.queue.shift();
        if (!task) {
            this.worker?.unref();
            if (this.worker) {
                clearTimeout(this.idleTimer);
                this.idleTimer = setTimeout(() => this.stopWorker(), this.options.idleTimeoutMs ?? 30_000);
                this.idleTimer.unref();
            }
            return;
        }
        this.queuedBytes -= task.size;
        this.active = task;
        clearTimeout(this.idleTimer);
        try {
            const worker = this.ensureWorker();
            worker.ref();
            task.timer = setTimeout(() => this.finishAll(), this.options.timeoutMs ?? 30_000);
            if (task.input.kind === 'decode') {
                // A readFile result may be pooled or shared. Transfer a dedicated copy only.
                const bytes = new Uint8Array(task.input.bytes.byteLength);
                bytes.set(task.input.bytes);
                worker.postMessage({ ...task.input, bytes, id: task.id }, [bytes.buffer]);
            } else {
                // Object input uses structured clone, with bounded but nonzero host overhead.
                worker.postMessage({ ...task.input, id: task.id });
            }
        } catch { this.finishAll(); }
    }

    private ensureWorker(): Worker {
        if (this.worker) { return this.worker; }
        const worker = new Worker(this.options.workerPath, {
            resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
        });
        this.worker = worker;
        worker.on('message', (reply: IndexSerializationReply) => {
            if (this.worker !== worker) { return; }
            const task = this.active;
            if (!task || reply.id !== task.id || (reply.result && (reply.result.kind !== task.input.kind
                || (reply.result.kind === 'encode' && (!(reply.result.bytes instanceof Uint8Array)
                    || reply.result.bytes.byteLength > maxIndexCacheBytes))))) { this.finishAll(); return; }
            this.active = undefined;
            this.cleanup(task);
            task.resolve(reply.result);
            // Release JSON/clone high-water marks instead of retaining a large worker heap.
            if (task.size >= 32 * 1024 * 1024) { this.stopWorker(); }
            this.pump();
        });
        worker.on('error', () => { if (this.worker === worker) { this.finishAll(); } });
        worker.on('exit', () => { if (this.worker === worker) { this.finishAll(); } });
        return worker;
    }

    private cancel(task: SerializationTask): void {
        if (this.active === task) {
            this.active = undefined;
            this.stopWorker();
        } else {
            const index = this.queue.indexOf(task);
            if (index < 0) { return; }
            this.queue.splice(index, 1);
            this.queuedBytes -= task.size;
        }
        this.cleanup(task);
        task.reject(serializationAbortError());
        this.pump();
    }

    private finishAll(error?: Error): void {
        this.stopWorker();
        const tasks = [...this.queue, ...(this.active ? [this.active] : [])];
        this.queue.length = 0;
        this.queuedBytes = 0;
        this.active = undefined;
        for (const task of tasks) {
            this.cleanup(task);
            if (error) { task.reject(error); } else { task.resolve(undefined); }
        }
    }

    private cleanup(task: SerializationTask): void {
        clearTimeout(task.timer);
        task.signal?.removeEventListener('abort', task.abort);
    }

    private stopWorker(): void {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        const worker = this.worker;
        this.worker = undefined;
        if (!worker) { return; }
        const stopping = worker.terminate().then(() => undefined);
        this.stopping = stopping;
        void stopping.then(() => {
            if (this.stopping !== stopping) { return; }
            this.stopping = undefined;
            this.pump();
        }, () => {
            if (this.stopping !== stopping) { return; }
            this.stopping = undefined;
            this.finishAll();
        });
    }
}

function serializationAbortError(): Error {
    const error = new Error('Index serialization cancelled.');
    error.name = 'AbortError';
    return error;
}

let serializationService: IndexSerializationService | undefined;
export function registerIndexSerialization(extensionPath: string): { dispose(): void } {
    serializationService?.dispose();
    const service = new IndexSerializationService({ workerPath: path.join(extensionPath, 'dist', 'index-serialization-worker.js') });
    serializationService = service;
    return { dispose() {
        service.dispose();
        if (serializationService === service) { serializationService = undefined; }
    } };
}

export function serializeIndex(input: IndexSerializationInput, signal?: AbortSignal): Promise<IndexSerializationResult | undefined> {
    if (signal?.aborted) { return Promise.reject(serializationAbortError()); }
    return serializationService?.run(input, signal) ?? Promise.resolve(undefined);
}
