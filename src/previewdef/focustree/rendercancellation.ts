import { UserError } from '../../util/common';

export const focusTreeRenderCancellationBatchSize = 128;

export function throwIfFocusTreeRenderCancelled(isCancelled?: () => boolean): void {
    if (isCancelled?.()) {
        throw new UserError('Focus tree render cancelled.');
    }
}

export async function yieldToFocusTreeRenderCancellation(isCancelled?: () => boolean): Promise<void> {
    throwIfFocusTreeRenderCancelled(isCancelled);
    if (!isCancelled) {
        return;
    }

    // Yield to host events without Windows' minimum timer delay on every render batch.
    await new Promise<void>(resolve => setImmediate(resolve));
    throwIfFocusTreeRenderCancelled(isCancelled);
}
