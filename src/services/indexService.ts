import * as vscode from 'vscode';
import { localizer } from './localizer';
import { sendEvent } from '../util/telemetry';
import { incrementPerfCounter, measureAsync } from '../util/perf';
import { indexCacheUri, indexFingerprint, readIndexCache, saveIndexCache, IndexCacheSpec } from './indexCache';
import { Commands } from '../constants';

export interface IndexTarget<TSnapshot> {
    build(estimatedSize: [number], signal: AbortSignal): Promise<TSnapshot>;
    cache?: IndexCacheSpec;
    commit(snapshot: TSnapshot): void;
    reset(): void;
    statusMessage: string;
    telemetryEvent: string;
}

interface IndexTask {
    generation: number;
    promise: Promise<void>;
    controller: AbortController;
}

const liveBuilds = new Set<{ label: string; phase: string; size: [number]; controller: AbortController }>();

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

    constructor(
        private readonly targets: Record<string, IndexTarget<TSnapshot>>,
    ) {}

    public ensure(targetId: string, options?: { showStatusBar?: boolean }): Promise<void> {
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
        const buildTask = measureAsync('index.build', { target: targetId }, async () => {
            const cacheUri = target.cache ? indexCacheUri(target.telemetryEvent) : undefined;
            let fingerprint: string | undefined;
            if (cacheUri && target.cache) {
                live.phase = 'Checking cache';
                try {
                    fingerprint = await indexFingerprint(target.cache, controller.signal);
                    const cached = await readIndexCache<TSnapshot>(cacheUri, fingerprint);
                    if (cached !== undefined) { incrementPerfCounter('index.disk.hit', { target: targetId }); return cached; }
                } catch { controller.signal.throwIfAborted(); }
            }
            live.phase = 'Building';
            const result = await target.build(estimatedSize, controller.signal);
            controller.signal.throwIfAborted();
            if (cacheUri && fingerprint && target.cache && this.getGeneration(targetId) === generation) {
                live.phase = 'Saving cache';
                // Never bless a snapshot built across a source edit with the new fingerprint.
                try {
                    if (fingerprint === await indexFingerprint(target.cache, controller.signal)) {
                        await saveIndexCache(cacheUri, fingerprint, result, controller.signal);
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

    private getGeneration(targetId: string): number {
        return this.generations.get(targetId) ?? 0;
    }
}
