import * as path from 'node:path';
import { Worker } from 'node:worker_threads';
import { performance } from 'node:perf_hooks';
import { incrementPerfCounter, recordPerf } from '../perf';
import { UserError } from '../common';
import { ComputeInput, ComputeReply, ComputeResult, isComputeInputSupported, maxComputeInputBytes, minimumComputePixels } from './protocol';

export interface RustComputeOptions {
    workerPath: string;
    wasmPath: string;
    minimumPixels?: number;
    timeoutMs?: number;
    idleTimeoutMs?: number;
}

interface Task {
    id: number;
    input: ComputeInput;
    signal?: AbortSignal;
    queuedAt: number;
    startedAt?: number;
    resolve(result: ComputeResult | undefined): void;
    reject(error: Error): void;
    abort(): void;
    timer?: NodeJS.Timeout;
}

export class RustComputeService {
    private worker: Worker | undefined;
    private stopping: Promise<void> | undefined;
    private active: Task | undefined;
    private readonly queue: Task[] = [];
    private queuedBytes = 0;
    private nextId = 1;
    private idleTimer: NodeJS.Timeout | undefined;
    private disposed = false;
    private failed = false;

    constructor(private readonly options: RustComputeOptions) {}

    public run(input: ComputeInput, signal?: AbortSignal): Promise<ComputeResult | undefined> {
        if (signal?.aborted) {
            return Promise.reject(abortError());
        }
        if (this.disposed) {
            return Promise.reject(abortError());
        }
        if (this.failed || process.env.HOI4MU_COMPUTE_BACKEND === 'typescript'
            || !isComputeInputSupported(input)
            || (!(input.kind === 'dds' && input.offloadSmallImage) && input.width * input.height < (this.options.minimumPixels ?? minimumComputePixels))) {
            incrementPerfCounter('rustcompute.fallback', { kind: input.kind, reason: this.failed ? 'unavailable' : 'policy' });
            return Promise.resolve(undefined);
        }
        if (this.queue.length >= 8 || this.queuedBytes + input.bytes.byteLength > maxComputeInputBytes) {
            incrementPerfCounter('rustcompute.fallback', { kind: input.kind, reason: 'queue-limit' });
            return Promise.resolve(undefined);
        }
        return new Promise((resolve, reject) => {
            const task: Task = {
                id: this.nextId++, input, signal, queuedAt: performance.now(), resolve, reject,
                abort: () => this.cancel(task),
            };
            this.queue.push(task);
            this.queuedBytes += input.bytes.byteLength;
            signal?.addEventListener('abort', task.abort, { once: true });
            if (signal?.aborted) {
                this.cancel(task);
            } else {
                this.pump();
            }
        });
    }

    public dispose(): void {
        this.disposed = true;
        this.stopWorker();
        const tasks = [...this.queue, ...(this.active ? [this.active] : [])];
        this.queue.length = 0;
        this.queuedBytes = 0;
        this.active = undefined;
        for (const task of tasks) {
            this.cleanup(task);
            task.reject(abortError());
        }
    }

    private pump(): void {
        if (this.active || this.disposed || this.failed || this.stopping) {
            return;
        }
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
        this.queuedBytes -= task.input.bytes.byteLength;
        this.active = task;
        task.startedAt = performance.now();
        clearTimeout(this.idleTimer);
        try {
            const worker = this.ensureWorker();
            worker.ref();
            task.timer = setTimeout(() => this.fail(new Error('Rust compute worker timed out.')), this.options.timeoutMs ?? 30_000);
            // Transfer only a dedicated copy, never detach a cached buffer or Node's Buffer pool.
            const bytes = new Uint8Array(task.input.bytes.byteLength);
            bytes.set(task.input.bytes);
            worker.postMessage({ ...task.input, bytes, id: task.id }, [bytes.buffer]);
        } catch (error) {
            this.fail(error);
        }
    }

    private ensureWorker(): Worker {
        if (this.worker) {
            return this.worker;
        }
        const worker = new Worker(this.options.workerPath, { workerData: { wasmPath: this.options.wasmPath } });
        this.worker = worker;
        worker.on('message', (reply: ComputeReply) => {
            if (worker !== this.worker) {
                return;
            }
            const task = this.active;
            if (!task || reply.id !== task.id) {
                this.fail(new Error('Unexpected Rust compute reply.'));
                return;
            }
            if (reply.error && reply.errorKind === 'rejected') {
                this.active = undefined;
                this.cleanup(task);
                incrementPerfCounter('rustcompute.fallback', { kind: task.input.kind, reason: 'rejected' });
                task.resolve(undefined);
                if (reply.retireWorker) {
                    this.stopWorker();
                }
                this.pump();
                return;
            }
            if (reply.error && reply.errorKind === 'input') {
                this.active = undefined;
                this.cleanup(task);
                task.reject(reply.userError ? new UserError(reply.error) : new Error(reply.error));
                this.pump();
                return;
            }
            if (reply.error || !reply.result) {
                this.fail(new Error(reply.error ?? 'Missing Rust compute result.'));
                return;
            }
            this.active = undefined;
            this.cleanup(task);
            recordPerf('rustcompute.compute', performance.now() - task.queuedAt, {
                kind: task.input.kind, inputBytes: task.input.bytes.byteLength,
                pixels: task.input.width * task.input.height, workerMs: reply.durationMs,
                engine: reply.result.engine ?? 'rust-wasm',
                queueMs: (task.startedAt ?? task.queuedAt) - task.queuedAt,
            });
            task.resolve(reply.result);
            // WASM memory cannot shrink; release large high-water marks instead of retaining them.
            if (reply.result.retireWorker || task.input.width * task.input.height * 4 >= 64 * 1024 * 1024) {
                this.stopWorker();
            }
            this.pump();
        });
        worker.on('error', error => { if (worker === this.worker) { this.fail(error); } });
        worker.on('exit', code => {
            if (worker === this.worker) {
                this.fail(new Error(`Rust compute worker exited (${code}).`));
            }
        });
        return worker;
    }

    private cancel(task: Task): void {
        if (this.active === task) {
            this.active = undefined;
            this.stopWorker();
        } else {
            const index = this.queue.indexOf(task);
            if (index < 0) {
                return;
            }
            this.queue.splice(index, 1);
            this.queuedBytes -= task.input.bytes.byteLength;
        }
        this.cleanup(task);
        task.reject(abortError());
        this.pump();
    }

    private fail(error: unknown): void {
        this.failed = true;
        recordPerf('rustcompute.unavailable', 0, {}, false, error);
        this.stopWorker();
        const tasks = [...(this.active ? [this.active] : []), ...this.queue];
        this.active = undefined;
        this.queue.length = 0;
        this.queuedBytes = 0;
        for (const task of tasks) {
            this.cleanup(task);
            task.resolve(undefined);
        }
    }

    private cleanup(task: Task): void {
        clearTimeout(task.timer);
        task.signal?.removeEventListener('abort', task.abort);
    }

    private stopWorker(): void {
        clearTimeout(this.idleTimer);
        this.idleTimer = undefined;
        const worker = this.worker;
        this.worker = undefined;
        if (worker) {
            const stopping = worker.terminate().then(() => undefined);
            this.stopping = stopping;
            void stopping.then(() => {
                if (this.stopping === stopping) {
                    this.stopping = undefined;
                    this.pump();
                }
            }, error => {
                if (this.stopping === stopping) {
                    this.stopping = undefined;
                    this.fail(error);
                }
            });
        }
    }
}

function abortError(): Error {
    const error = new Error('Rust compute cancelled.');
    error.name = 'AbortError';
    return error;
}

let computeService: RustComputeService | undefined;

export function registerRustCompute(extensionPath: string): { dispose(): void } {
    computeService?.dispose();
    const service = new RustComputeService({
        workerPath: path.join(extensionPath, 'dist', 'compute-worker.js'),
        wasmPath: path.join(extensionPath, 'dist', 'hoi4_compute.wasm'),
    });
    computeService = service;
    return {
        dispose() {
            service.dispose();
            if (computeService === service) {
                computeService = undefined;
            }
        },
    };
}

export function tryRustCompute(input: ComputeInput, signal?: AbortSignal): Promise<ComputeResult | undefined> {
    if (signal?.aborted) {
        return Promise.reject(abortError());
    }
    return computeService?.run(input, signal) ?? Promise.resolve(undefined);
}
