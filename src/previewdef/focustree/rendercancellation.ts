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

    await new Promise<void>(resolve => setTimeout(resolve, 0));
    throwIfFocusTreeRenderCancelled(isCancelled);
}
