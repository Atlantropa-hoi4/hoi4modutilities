import * as assert from 'assert';
import { getFocusPosition, getLocalPositionFromRenderedAbsolute } from '../../src/previewdef/focustree/positioning';
import type { FocusTreeView, FocusView } from '../../src/previewdef/focustree/viewmodel';
import type { NumberPosition } from '../../src/util/common';

describe('focus position resolution', () => {
    const createFocus = (id: string, x: number, y: number, relativePositionId?: string): FocusView => ({
        id,
        x,
        y,
        relativePositionId,
        offset: [],
    } as unknown as FocusView);
    const createTree = (...focuses: FocusView[]): FocusTreeView => ({
        focuses: Object.fromEntries(focuses.map(focus => [focus.id, focus])),
    } as FocusTreeView);

    it('resolves very deep relative chains without overflowing and reuses cached anchor positions', () => {
        const focusCount = 20000;
        const focuses = Array.from({ length: focusCount }, (_value, index) =>
            createFocus(`FOCUS_${index}`, 1, 2, index === 0 ? undefined : `FOCUS_${index - 1}`));
        const tree = createTree(...focuses);
        const cache: Record<string, NumberPosition> = {};

        assert.deepStrictEqual(getFocusPosition(focuses[focusCount - 1], cache, tree, []), {
            x: focusCount,
            y: focusCount * 2,
        });
        assert.strictEqual(Object.keys(cache).length, focusCount);
        assert.strictEqual(getFocusPosition(focuses[0], cache, tree, []), cache.FOCUS_0);
    });

    it('applies conditional offsets at each anchor and converts rendered positions back to local coordinates', () => {
        const root = createFocus('ROOT', 3, 4);
        const child = createFocus('CHILD', 1, 2, 'ROOT');
        const condition = { scopeName: '', nodeContent: 'has_country_flag = shifted' };
        root.offset = [{ x: 5, y: 6, trigger: condition }, { x: 2, y: 0, trigger: undefined }];
        child.offset = [{ x: 3, y: 4, trigger: condition }];
        const tree = createTree(root, child);

        assert.deepStrictEqual(getFocusPosition(child, {}, tree, []), { x: 6, y: 6 });
        assert.deepStrictEqual(getFocusPosition(child, {}, tree, [condition]), { x: 14, y: 16 });
        assert.deepStrictEqual(getLocalPositionFromRenderedAbsolute(child, tree, [condition], { x: 14, y: 16 }), {
            x: 1,
            y: 2,
        });
    });

    it('retains zero-origin fallback and cache order for cyclic and missing relative targets', () => {
        const a = createFocus('A', 1, 2, 'B');
        const b = createFocus('B', 3, 4, 'A');
        const missing = createFocus('MISSING', 5, 6, 'UNKNOWN');
        const tree = createTree(a, b, missing);
        const cache: Record<string, NumberPosition> = {};

        assert.deepStrictEqual(getFocusPosition(a, cache, tree, []), { x: 4, y: 6 });
        assert.deepStrictEqual(cache.B, { x: 3, y: 4 });
        assert.strictEqual(getFocusPosition(b, cache, tree, []), cache.B);
        assert.deepStrictEqual(getFocusPosition(missing, {}, tree, []), { x: 5, y: 6 });
        assert.deepStrictEqual(getFocusPosition(undefined, {}, tree, []), { x: 0, y: 0 });
    });

    it('respects an existing traversal stack without mutating it and prefers cached positions', () => {
        const root = createFocus('ROOT', 3, 4);
        const child = createFocus('CHILD', 1, 2, 'ROOT');
        const tree = createTree(root, child);
        const stack = [root];
        const cachedRoot = { x: 9, y: 10 };

        assert.deepStrictEqual(getFocusPosition(child, {}, tree, [], stack), { x: 1, y: 2 });
        assert.deepStrictEqual(getFocusPosition(child, { ROOT: cachedRoot }, tree, [], stack), { x: 10, y: 12 });
        assert.deepStrictEqual(stack, [root]);
    });
});
