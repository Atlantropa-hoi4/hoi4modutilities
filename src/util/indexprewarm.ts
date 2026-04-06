import * as vscode from 'vscode';
import { error } from './debug';
import { prewarmGfxIndex } from './gfxindex';
import { prewarmLocalisationIndex } from './localisationIndex';
import { prewarmSharedFocusIndex } from './sharedFocusIndex';

const previewIndexPrewarmDelayMs = 2500;

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

    for (const step of steps) {
        try {
            await step();
        } catch (e) {
            error(e);
        }
    }
}
