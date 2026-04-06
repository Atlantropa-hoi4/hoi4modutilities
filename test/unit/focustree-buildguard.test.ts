import * as assert from 'assert';
import { LatestOnlyBuildGuard } from '../../src/previewdef/focustree/buildguard';

describe('focustree build guard', () => {
    it('invalidates older build tokens after a newer build starts', () => {
        const guard = new LatestOnlyBuildGuard();

        const first = guard.start();
        const second = guard.start();

        assert.strictEqual(guard.isCurrent(first), false);
        assert.strictEqual(guard.isCurrent(second), true);
    });
});
