import * as assert from 'assert';
import { LoaderSession } from '../../src/util/loader/loadersession';
import type { Loader } from '../../src/util/loader/loader';

type AnyLoader = Loader<unknown, unknown>;

describe('loader session state', () => {
    it('shares completed and reload state with child sessions', () => {
        const parent = new LoaderSession(false);
        const firstLoader = createLoader('first');
        const secondLoader = createLoader('second');
        parent.setLoaded(firstLoader);
        parent.checkingShouldReload(secondLoader);

        const child = parent.forChild();
        assert.strictEqual(child.isLoaded(firstLoader), true);
        assert.strictEqual(child.shouldReload(secondLoader), 'checking');

        child.setLoaded(secondLoader);
        child.setShouldReload(secondLoader);
        assert.strictEqual(parent.isLoaded(secondLoader), true);
        assert.strictEqual(parent.shouldReload(secondLoader), true);
        assert.deepStrictEqual(parent.getLoadedLoaderNames(), ['first', 'second']);
    });

    it('copies the active loading stack without sharing later stack mutations', () => {
        const parent = new LoaderSession(false);
        const parentLoader = createLoader('parent', 'common/parent.txt');
        const childLoader = createLoader('child', 'common/child.txt');
        parent.beginLoading(parentLoader);

        const child = parent.forChild();
        child.beginLoading(childLoader);

        assert.throws(
            () => child.throwIfLoadingFile('common/parent.txt'),
            /Circular dependency when loading file/,
        );
        assert.doesNotThrow(() => parent.throwIfLoadingFile('common/parent.txt'));

        child.endLoading(childLoader);
        child.endLoading(parentLoader);
        parent.endLoading(parentLoader);
    });

    it('uses a key-safe cache shared by child sessions', () => {
        class CachedLoader {
            constructor(public readonly file: string) {}
        }
        const loaderType = CachedLoader as unknown as { new (file: string): AnyLoader };
        const parent = new LoaderSession(false);
        const first = parent.createOrGetCachedLoader('__proto__', loaderType);
        const child = parent.forChild();

        assert.strictEqual(child.createOrGetCachedLoader('__proto__', loaderType), first);
    });

    it('throws when a cancellation callback invalidates the session', () => {
        const session = new LoaderSession(false, () => true);
        assert.throws(() => session.throwIfCancelled(), /Load session cancelled/);
    });
});

function createLoader(name: string, file?: string): AnyLoader {
    return {
        file,
        toString: () => name,
    } as unknown as AnyLoader;
}
