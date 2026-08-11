interface DisposableLike {
    dispose(): void;
}

export interface CancellationTokenLike {
    readonly isCancellationRequested: boolean;
    readonly onCancellationRequested: (listener: () => void) => DisposableLike;
}

export async function runCancellableOperation<T>(
    token: CancellationTokenLike,
    operation: () => PromiseLike<T>,
): Promise<T | null> {
    if (token.isCancellationRequested) {
        return null;
    }

    let resolveCancellation!: (value: null) => void;
    const cancellation = new Promise<null>(resolve => {
        resolveCancellation = resolve;
    });
    const cancellationSubscription = token.onCancellationRequested(() => resolveCancellation(null));

    if (token.isCancellationRequested) {
        cancellationSubscription.dispose();
        return null;
    }

    try {
        return await Promise.race([operation(), cancellation]);
    } finally {
        cancellationSubscription.dispose();
    }
}
