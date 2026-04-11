import * as assert from 'assert';
import {
    beginFocusTreeRefresh,
    consumePendingLocalEditVersion,
    consumePendingReadyBaseState,
    consumePendingReadyBaseStatePromise,
    createFocusTreeRuntimeState,
    isCurrentFocusTreeRefresh,
    recordPendingLocalEditVersion,
    resetFocusTreeRuntimeState,
    storePendingReadyBaseState,
    storePendingReadyBaseStatePromise,
} from '../../src/previewdef/focustree/runtime';

describe('focustree runtime state', () => {
    it('tracks refresh request ids so stale work can be discarded', () => {
        const state = createFocusTreeRuntimeState();

        const first = beginFocusTreeRefresh(state);
        const second = beginFocusTreeRefresh(state);

        assert.strictEqual(isCurrentFocusTreeRefresh(state, first), false);
        assert.strictEqual(isCurrentFocusTreeRefresh(state, second), true);
    });

    it('stores and consumes pending local edit document versions once', () => {
        const state = createFocusTreeRuntimeState();

        recordPendingLocalEditVersion(state, 7);

        assert.strictEqual(consumePendingLocalEditVersion(state, 7), true);
        assert.strictEqual(consumePendingLocalEditVersion(state, 7), false);
    });

    it('keeps pending ready base state and promise scoped to one document version', async () => {
        const state = createFocusTreeRuntimeState();
        const baseState = { focusPositionDocumentVersion: 12 } as any;
        const pendingPromise = Promise.resolve(baseState);

        storePendingReadyBaseState(state, baseState);
        storePendingReadyBaseStatePromise(state, {
            documentVersion: 12,
            promise: pendingPromise,
        });

        assert.strictEqual(consumePendingReadyBaseState(state, 9), undefined);
        assert.strictEqual(consumePendingReadyBaseState(state, 12), baseState);
        assert.strictEqual(consumePendingReadyBaseState(state, 12), undefined);

        assert.strictEqual(await consumePendingReadyBaseStatePromise(state, 12), baseState);
        assert.strictEqual(consumePendingReadyBaseStatePromise(state, 12), undefined);
    });

    it('resets volatile session state without losing tracked local edits', () => {
        const state = createFocusTreeRuntimeState();
        state.webviewReady = true;
        state.lastRenderCache = {} as any;
        state.pendingReadyBaseState = {} as any;
        state.pendingReadyBaseStatePromise = {
            documentVersion: 3,
            promise: Promise.resolve({} as any),
        };
        state.deferredHydrationDocumentVersion = 9;
        recordPendingLocalEditVersion(state, 4);

        resetFocusTreeRuntimeState(state);

        assert.strictEqual(state.webviewReady, false);
        assert.strictEqual(state.lastRenderCache, undefined);
        assert.strictEqual(state.pendingReadyBaseState, undefined);
        assert.strictEqual(state.pendingReadyBaseStatePromise, undefined);
        assert.strictEqual(state.deferredHydrationDocumentVersion, undefined);
        assert.strictEqual(state.pendingLocalEditDocumentVersions.has(4), true);
    });
});
