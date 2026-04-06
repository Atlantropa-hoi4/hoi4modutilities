import * as vscode from 'vscode';
import { localizer } from './localizer';
import { sendEvent } from '../util/telemetry';

export interface IndexTarget<TSnapshot> {
    build(estimatedSize: [number]): Promise<void>;
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
            return Promise.resolve();
        }

        const generation = this.getGeneration(targetId);
        const existingTask = this.tasks.get(targetId);
        if (existingTask?.generation === generation) {
            return existingTask.promise;
        }

        const target = this.targets[targetId];
        const estimatedSize: [number] = [0];
        const buildTask = target.build(estimatedSize);
        const showStatusBar = options?.showStatusBar ?? true;
        if (showStatusBar) {
            vscode.window.setStatusBarMessage('$(loading~spin) ' + localizer.t(target.statusMessage), buildTask);
        }

        const task = buildTask
            .then(() => {
                if (this.getGeneration(targetId) !== generation) {
                    return;
                }
                this.readyTargets.add(targetId);
                sendEvent(target.telemetryEvent, { size: estimatedSize[0].toString() });
            })
            .finally(() => {
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
        const target = this.targets[targetId];
        target.reset();
        this.readyTargets.delete(targetId);
        this.tasks.delete(targetId);
        this.generations.set(targetId, this.getGeneration(targetId) + 1);
    }

    public isReady(targetId: string): boolean {
        return this.readyTargets.has(targetId);
    }

    private getGeneration(targetId: string): number {
        return this.generations.get(targetId) ?? 0;
    }
}
