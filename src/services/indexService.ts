import * as vscode from 'vscode';
import { localizer } from './localizer';
import { sendEvent } from '../util/telemetry';
import { incrementPerfCounter, measureAsync } from '../util/perf';

export interface IndexTarget<TSnapshot> {
    build(estimatedSize: [number]): Promise<TSnapshot>;
    commit(snapshot: TSnapshot): void;
    reset(): void;
    statusMessage: string;
    telemetryEvent: string;
}

interface IndexTask {
    generation: number;
    promise: Promise<void>;
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
        const buildTask = measureAsync('index.build', { target: targetId }, () => target.build(estimatedSize));
        const showStatusBar = options?.showStatusBar ?? true;
        if (showStatusBar) {
            vscode.window.setStatusBarMessage('$(loading~spin) ' + localizer.t(target.statusMessage), buildTask);
        }

        const task = (async () => {
            let snapshot: TSnapshot;
            try {
                snapshot = await buildTask;
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
            const currentTask = this.tasks.get(targetId);
            if (currentTask?.generation === generation && currentTask.promise === task) {
                this.tasks.delete(targetId);
            }
        });
        this.tasks.set(targetId, { generation, promise: task });
        return task;
    }

    public async warm(targetIds: string[], options?: { showStatusBar?: boolean }): Promise<void> {
        await Promise.all(targetIds.map(targetId => this.ensure(targetId, options)));
    }

    public invalidate(targetId: string): void {
        incrementPerfCounter('index.invalidate', { target: targetId });
        const target = this.targets[targetId];
        target.reset();
        this.readyTargets.delete(targetId);
        this.tasks.delete(targetId);
        this.generations.set(targetId, this.getGeneration(targetId) + 1);
    }

    public isReady(targetId: string): boolean {
        return this.readyTargets.has(targetId);
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
            void this.ensure(targetId, options);
        });
        return true;
    }

    private getGeneration(targetId: string): number {
        return this.generations.get(targetId) ?? 0;
    }
}
