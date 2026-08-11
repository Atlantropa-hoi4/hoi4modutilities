import * as assert from 'assert';
import { runCancellableOperation } from '../../src/services/cancellableOperation';

describe('cancellable operation', () => {
    it('does not start an operation when cancellation was already requested', async () => {
        const token = new TestCancellationToken();
        token.cancel();
        let operationStarted = false;

        const result = await runCancellableOperation(token, async () => {
            operationStarted = true;
            return 'result';
        });

        assert.strictEqual(result, null);
        assert.strictEqual(operationStarted, false);
        assert.strictEqual(token.listenerCount, 0);
    });

    it('disposes its cancellation listener after the operation completes', async () => {
        const token = new TestCancellationToken();

        const result = await runCancellableOperation(token, async () => 'result');

        assert.strictEqual(result, 'result');
        assert.strictEqual(token.listenerCount, 0);
        assert.strictEqual(token.disposedListenerCount, 1);
    });

    it('returns null and disposes its listener when cancellation wins', async () => {
        const token = new TestCancellationToken();
        const operation = new Promise<string>(() => undefined);

        const resultPromise = runCancellableOperation(token, () => operation);
        token.cancel();

        assert.strictEqual(await resultPromise, null);
        assert.strictEqual(token.listenerCount, 0);
        assert.strictEqual(token.disposedListenerCount, 1);
    });

    it('disposes its listener when the operation fails', async () => {
        const token = new TestCancellationToken();
        const failure = new Error('failed');

        await assert.rejects(
            runCancellableOperation(token, async () => { throw failure; }),
            error => error === failure,
        );
        assert.strictEqual(token.listenerCount, 0);
        assert.strictEqual(token.disposedListenerCount, 1);
    });
});

class TestCancellationToken {
    private cancelled = false;
    private readonly listeners = new Set<() => void>();
    public disposedListenerCount = 0;

    public get isCancellationRequested(): boolean {
        return this.cancelled;
    }

    public get listenerCount(): number {
        return this.listeners.size;
    }

    public readonly onCancellationRequested = (listener: () => void) => {
        this.listeners.add(listener);
        return {
            dispose: () => {
                if (this.listeners.delete(listener)) {
                    this.disposedListenerCount++;
                }
            },
        };
    };

    public cancel(): void {
        if (this.cancelled) {
            return;
        }

        this.cancelled = true;
        for (const listener of [...this.listeners]) {
            listener();
        }
    }
}
