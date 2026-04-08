import * as vscode from 'vscode';
import { localizer } from './localizer';
import { sendEvent } from '../util/telemetry';

export interface IndexTarget<TSnapshot> {
    build(estimatedSize: [number]): Promise<void>;
    reset(): void;
    statusMessage: string;
    telemetryEvent: string;
}

export class IndexService<TSnapshot> {
    private readonly readyTargets = new Set<string>();
    private readonly tasks = new Map<string, Promise<void>>();

    constructor(
        private readonly targets: Record<string, IndexTarget<TSnapshot>>,
    ) {}

    public ensure(targetId: string, options?: { showStatusBar?: boolean }): Promise<void> {
        if (this.readyTargets.has(targetId)) {
            return Promise.resolve();
        }

        const existingTask = this.tasks.get(targetId);
        if (existingTask) {
            return existingTask;
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
                this.readyTargets.add(targetId);
                sendEvent(target.telemetryEvent, { size: estimatedSize[0].toString() });
            })
            .finally(() => {
                this.tasks.delete(targetId);
            });
        this.tasks.set(targetId, task);
        return task;
    }

    public async warm(targetIds: string[], options?: { showStatusBar?: boolean }): Promise<void> {
        await Promise.all(targetIds.map(targetId => this.ensure(targetId, options)));
    }

    public invalidate(targetId: string): void {
        const target = this.targets[targetId];
        target.reset();
        this.readyTargets.delete(targetId);
    }

    public isReady(targetId: string): boolean {
        return this.readyTargets.has(targetId);
    }
}
