import * as vscode from 'vscode';
import { localizer } from './localizer';
import { sendEvent } from '../util/telemetry';
import { incrementPerfCounter, measureAsync } from '../util/perf';
import { indexCacheUri, indexFingerprint, readIndexCache, saveIndexCache } from './indexCache';
import type { IndexCacheSpec } from './indexCache';
import { Commands } from '../constants';

interface IndexTargetBase<TSnapshot> {
    build(estimatedSize: [number], signal: AbortSignal): Promise<TSnapshot>;
    commit(snapshot: TSnapshot): void;
    reset(): void;
    statusMessage: string;
    telemetryEvent: string;
}

export type IndexTarget<TSnapshot> = IndexTargetBase<TSnapshot> & (
    | { cache: IndexCacheSpec; validateCacheSnapshot(value: unknown): value is TSnapshot }
    | { cache?: undefined }
);

interface IndexTask {
    generation: number;
    promise: Promise<void>;
    controller: AbortController;
}

const liveBuilds = new Set<{ label: string; phase: string; size: [number]; controller: AbortController }>();
const indexServices = new Set<IndexService<unknown>>();

export function registerIndexServiceLifecycle(): { dispose(): void } {
    return { dispose() {
        for (const service of indexServices) { service.dispose(); }
        indexServices.clear();
    } };
}

class IndexBuildCancelledError extends Error {
    constructor() { super(localizer.t('Index build cancelled.')); }
}

export function registerIndexCommands(): vscode.Disposable {
    return vscode.Disposable.from(
        vscode.commands.registerCommand(Commands.ShowIndexStatus, () => {
            const message = [...liveBuilds].map(build => `${localizer.t(build.label)} ${localizer.t(build.phase)} (${Math.round(build.size[0] / 1024)} KB)`).join('\n');
            return vscode.window.showInformationMessage(message || localizer.t('No index build is running.'));
        }),
        vscode.commands.registerCommand(Commands.CancelIndexBuild, async () => {
            const options = [...liveBuilds].map(build => ({ label: localizer.t(build.label), build }));
            if (!options.length) { await vscode.window.showInformationMessage(localizer.t('No index build is running.')); return; }
            const selected = await vscode.window.showQuickPick(options, { placeHolder: localizer.t('Choose an index build to cancel') });
            selected?.build.controller.abort(new IndexBuildCancelledError());
        }),
    );
}

export class IndexService<TSnapshot> {
    private readonly readyTargets = new Set<string>();
    private readonly tasks = new Map<string, IndexTask>();
    private readonly generations = new Map<string, number>();
    private readonly saves = new Map<string, { controller: AbortController; promise: Promise<void> }>();
    private disposed = false;

    constructor(
        private readonly targets: Record<string, IndexTarget<TSnapshot>>,
    ) { indexServices.add(this as IndexService<unknown>); }

    public ensure(targetId: string, options?: { showStatusBar?: boolean }): Promise<void> {
        if (this.disposed) { return Promise.reject(new IndexBuildCancelledError()); }
        if (this.readyTargets.has(targetId)) {
            incrementPerfCounter('index.ensure.ready', { target: targetId });
            return Promise.resolve();
        }

        const generation = this.getGeneration(targetId);
        const existingTask = this.tasks.get(targetId);
        if (existingTask?.generation === generation) {
            incrementPerfCounter('index.ensure.inflight', { target: targetId });
            return existingTask.promise;
        }

        const target = this.targets[targetId];
        const estimatedSize: [number] = [0];
        const controller = new AbortController();
        const live = { label: target.statusMessage, phase: 'Building', size: estimatedSize, controller };
        liveBuilds.add(live);
        let persistence: { uri: vscode.Uri; fingerprint: string; snapshot: TSnapshot } | undefined;
        const buildTask = measureAsync('index.build', { target: targetId }, async () => {
            const cacheUri = target.cache ? indexCacheUri(target.telemetryEvent) : undefined;
            let fingerprint: string | undefined;
            if (cacheUri && target.cache) {
                live.phase = 'Checking cache';
                try {
                    fingerprint = await indexFingerprint(target.cache, controller.signal);
                    const cached = await readIndexCache(cacheUri, fingerprint, controller.signal);
                    if (cached !== undefined && target.validateCacheSnapshot(cached)) {
                        controller.signal.throwIfAborted();
                        if (fingerprint !== await indexFingerprint(target.cache, controller.signal)) {
                            this.invalidate(targetId);
                        }
                        incrementPerfCounter('index.disk.hit', { target: targetId });
                        return cached;
                    }
                } catch { controller.signal.throwIfAborted(); }
            }
            live.phase = 'Building';
            const result = await target.build(estimatedSize, controller.signal);
            controller.signal.throwIfAborted();
            if (cacheUri && fingerprint && target.cache && this.getGeneration(targetId) === generation) {
                live.phase = 'Checking sources';
                // Never publish or bless a snapshot built across a source edit.
                try {
                    if (fingerprint !== await indexFingerprint(target.cache, controller.signal)) {
                        this.invalidate(targetId);
                    } else {
                        persistence = { uri: cacheUri, fingerprint, snapshot: result };
                    }
                } catch { controller.signal.throwIfAborted(); }
            }
            return result;
        });
        const showStatusBar = options?.showStatusBar ?? true;
        if (showStatusBar) {
            vscode.window.setStatusBarMessage('$(loading~spin) ' + localizer.t(target.statusMessage), buildTask);
        }

        const task = (async () => {
            let snapshot: TSnapshot;
            try {
                snapshot = await buildTask;
                controller.signal.throwIfAborted();
            } catch (e) {
                if (this.getGeneration(targetId) !== generation) {
                    return this.ensure(targetId, options);
                }
                throw e;
            }

            if (this.getGeneration(targetId) !== generation) {
                return this.ensure(targetId, options);
            }
            target.commit(snapshot);
            this.readyTargets.add(targetId);
            sendEvent(target.telemetryEvent, { size: estimatedSize[0].toString() });
            if (persistence) {
                this.saves.get(targetId)?.controller.abort();
                const save = { controller, promise: Promise.resolve() };
                this.saves.set(targetId, save);
                // Let ensure/ready consumers run before structured cloning or storage work.
                save.promise = new Promise<void>(resolve => setImmediate(resolve)).then(async () => {
                    if (controller.signal.aborted || this.disposed || this.getGeneration(targetId) !== generation) {
                        persistence = undefined;
                        return;
                    }
                    const pending = saveIndexCache(persistence!.uri, persistence!.fingerprint, persistence!.snapshot, controller.signal);
                    persistence = undefined;
                    await pending;
                }).catch(() => { /* Detached persistence is strictly best effort. */ }).finally(() => {
                    if (this.saves.get(targetId) === save) { this.saves.delete(targetId); }
                });
            }
        })().finally(() => {
            liveBuilds.delete(live);
            const currentTask = this.tasks.get(targetId);
            if (currentTask?.generation === generation && currentTask.promise === task) {
                this.tasks.delete(targetId);
            }
        });
        this.tasks.set(targetId, { generation, promise: task, controller });
        return task;
    }

    public async warm(targetIds: string[], options?: { showStatusBar?: boolean }): Promise<void> {
        await Promise.all(targetIds.map(targetId => this.ensure(targetId, options)));
    }

    public invalidate(targetId: string): void {
        incrementPerfCounter('index.invalidate', { target: targetId });
        const target = this.targets[targetId];
        this.tasks.get(targetId)?.controller.abort();
        this.saves.get(targetId)?.controller.abort();
        this.saves.delete(targetId);
        target.reset();
        this.readyTargets.delete(targetId);
        this.tasks.delete(targetId);
        this.generations.set(targetId, this.getGeneration(targetId) + 1);
    }

    public isReady(targetId: string): boolean {
        return this.readyTargets.has(targetId);
    }

    public cancel(targetId: string): void {
        this.tasks.get(targetId)?.controller.abort(new IndexBuildCancelledError());
        this.saves.get(targetId)?.controller.abort(new IndexBuildCancelledError());
    }

    public isActive(targetId: string): boolean {
        return this.readyTargets.has(targetId) || this.tasks.has(targetId);
    }

    public rebuildIfActive(targetId: string, options?: { showStatusBar?: boolean }): boolean {
        if (!this.isActive(targetId)) {
            return false;
        }
        this.invalidate(targetId);
        queueMicrotask(() => {
            void this.ensure(targetId, options).catch(reason => {
                if (!(reason instanceof IndexBuildCancelledError)) { console.error(reason); }
            });
        });
        return true;
    }

    public dispose(): void {
        if (this.disposed) { return; }
        this.disposed = true;
        for (const targetId of Object.keys(this.targets)) { this.invalidate(targetId); }
        indexServices.delete(this as IndexService<unknown>);
    }

    private getGeneration(targetId: string): number {
        return this.generations.get(targetId) ?? 0;
    }
}
