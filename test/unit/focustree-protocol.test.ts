import * as assert from 'assert';
import { focusTreeProtocolVersion } from '../../src/previewdef/focustree/viewmodel';
import { getFocusTreeHostCommand } from '../../src/previewdef/focustree/webviewupdate';

describe('focus tree webview protocol v3', () => {
    it('uses the retained-scene protocol version', () => {
        assert.strictEqual(focusTreeProtocolVersion, 3);
    });

    it('maps content changes to the v3 discriminated message commands', () => {
        assert.strictEqual(getFocusTreeHostCommand('structure'), 'focusTreeScene');
        assert.strictEqual(getFocusTreeHostCommand('patch'), 'focusTreeScenePatch');
        assert.strictEqual(getFocusTreeHostCommand('assets'), 'focusTreeAssetBatch');
        assert.strictEqual(getFocusTreeHostCommand(undefined), 'focusTreeScene');
    });
});
