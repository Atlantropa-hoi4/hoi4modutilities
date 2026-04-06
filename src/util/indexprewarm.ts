import * as vscode from 'vscode';
import { error } from './debug';
import { prewarmGfxIndex } from './gfxindex';
import { prewarmLocalisationIndex } from './localisationIndex';
import { prewarmSharedFocusIndex } from './sharedFocusIndex';

const previewIndexPrewarmDelayMs = 250;

export function registerIndexPrewarm(): vscode.Disposable {
    const timer = setTimeout(() => {
        void prewarmPreviewIndexes();
    }, previewIndexPrewarmDelayMs);
    timer.unref?.();

    return new vscode.Disposable(() => {
        clearTimeout(timer);
    });
}

async function prewarmPreviewIndexes(): Promise<void> {
    const steps = [
        prewarmSharedFocusIndex,
        prewarmGfxIndex,
        prewarmLocalisationIndex,
    ];

    await Promise.all(steps.map(async step => {
        try {
            await step();
        } catch (e) {
            error(e);
        }
    }));
}
