import * as assert from 'assert';
import { TechnologyPreviewRenderCoordinator } from '../../src/previewdef/technology/renderruntime';

describe('technology preview render coordination', () => {
    it('invalidates an in-flight render when a local position version skips rebuilding', () => {
        const coordinator = new TechnologyPreviewRenderCoordinator();
        const staleRender = coordinator.begin(1);
        coordinator.recordLocallyAppliedPositionVersion(2);

        const localEditRefresh = coordinator.begin(2);

        assert.strictEqual(localEditRefresh.skipRender, true);
        assert.strictEqual(coordinator.isCurrent(staleRender.generation), false);
        assert.strictEqual(coordinator.isCurrent(localEditRefresh.generation), true);
    });

    it('can discard a reserved version when the workspace edit is refused', () => {
        const coordinator = new TechnologyPreviewRenderCoordinator();
        const discard = coordinator.recordLocallyAppliedPositionVersion(2);
        discard();

        assert.strictEqual(coordinator.begin(2).skipRender, false);
    });
});
