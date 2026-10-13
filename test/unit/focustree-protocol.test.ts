import * as assert from 'assert';
import { focusTreeProtocolVersion } from '../../src/previewdef/focustree/viewmodel';
import { getFocusTreeHostCommand } from '../../src/previewdef/focustree/webviewupdate';

describe('focus tree webview protocol v5', () => {
    it('uses the versioned style-sync protocol version', () => {
        assert.strictEqual(focusTreeProtocolVersion, 5);
    });

    it('maps content changes to the discriminated message commands', () => {
        assert.strictEqual(getFocusTreeHostCommand('structure'), 'focusTreeScene');
        assert.strictEqual(getFocusTreeHostCommand('patch'), 'focusTreeScenePatch');
        assert.strictEqual(getFocusTreeHostCommand('assets'), 'focusTreeAssetBatch');
        assert.strictEqual(getFocusTreeHostCommand(undefined), 'focusTreeScene');
    });
});
