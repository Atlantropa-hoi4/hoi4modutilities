import * as assert from 'assert';
import { PreviewSessionStore } from '../../src/previewdef/previewsessionstore';
import type { PreviewBase } from '../../src/previewdef/previewbase';
import type { PreviewDependencyTracker } from '../../src/previewdef/previewdependencytracker';

describe('preview session store', () => {
    it('keeps a replacement preview when the previous preview disposes late', () => {
        const tracker = new FakeDependencyTracker();
        const store = new PreviewSessionStore(tracker as unknown as PreviewDependencyTracker);
        const previous = new FakePreview();
        const replacement = new FakePreview();

        store.add('file:///preview.txt', previous as unknown as PreviewBase);
        store.add('file:///preview.txt', replacement as unknown as PreviewBase);
        tracker.removed.length = 0;

        previous.emitDispose();

        assert.strictEqual(store.get('file:///preview.txt'), replacement as unknown as PreviewBase);
        assert.deepStrictEqual(tracker.removed, [previous]);
    });

    it('ignores dependency events from a preview that has been replaced', () => {
        const tracker = new FakeDependencyTracker();
        const store = new PreviewSessionStore(tracker as unknown as PreviewDependencyTracker);
        const previous = new FakePreview();
        const replacement = new FakePreview();

        store.add('file:///preview.txt', previous as unknown as PreviewBase);
        store.add('file:///preview.txt', replacement as unknown as PreviewBase);
        tracker.removed.length = 0;

        previous.emitDependencyChange(['stale.gfx']);
        replacement.emitDependencyChange(['current.gfx']);

        assert.deepStrictEqual(tracker.removed, [replacement]);
        assert.deepStrictEqual(tracker.added, [{ preview: replacement, dependencies: ['current.gfx'] }]);
    });

    it('removes the current preview and its dependencies on dispose', () => {
        const tracker = new FakeDependencyTracker();
        const store = new PreviewSessionStore(tracker as unknown as PreviewDependencyTracker);
        const preview = new FakePreview();

        store.add('file:///preview.txt', preview as unknown as PreviewBase);
        preview.emitDispose();

        assert.strictEqual(store.get('file:///preview.txt'), undefined);
        assert.deepStrictEqual(tracker.removed, [preview]);
    });
});

class FakePreview {
    private readonly disposeListeners: Array<() => void> = [];
    private readonly dependencyListeners: Array<(dependencies: string[]) => void> = [];

    public onDispose(listener: () => void): { dispose(): void } {
        this.disposeListeners.push(listener);
        return { dispose: () => undefined };
    }

    public onDependencyChanged(listener: (dependencies: string[]) => void): { dispose(): void } {
        this.dependencyListeners.push(listener);
        return { dispose: () => undefined };
    }

    public emitDispose(): void {
        this.disposeListeners.forEach(listener => listener());
    }

    public emitDependencyChange(dependencies: string[]): void {
        this.dependencyListeners.forEach(listener => listener(dependencies));
    }
}

class FakeDependencyTracker {
    public readonly removed: FakePreview[] = [];
    public readonly added: Array<{ preview: FakePreview; dependencies: string[] }> = [];

    public remove(preview: FakePreview): void {
        this.removed.push(preview);
    }

    public add(preview: FakePreview, dependencies: string[]): void {
        this.added.push({ preview, dependencies });
    }
}
