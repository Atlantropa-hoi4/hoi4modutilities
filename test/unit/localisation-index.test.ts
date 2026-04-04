import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            workspace: {
                getConfiguration: () => ({
                    featureFlags: ['localisationIndex'],
                    previewLocalisation: undefined,
                }),
            },
            env: {
                language: 'en',
            },
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    resolveLocalisedTextFromIndex,
} = require('../../src/util/localisationIndex') as typeof import('../../src/util/localisationIndex');

describe('localisation index helpers', () => {
    it('prefers the requested language and then falls back to english across global and workspace indexes', () => {
        const globalIndex = {
            l_korean: {
                FOCUS_A: '한국어 이름',
            },
            l_english: {
                FOCUS_A: 'English Name',
                FOCUS_B: 'English Fallback',
            },
        };
        const workspaceIndex = {
            l_korean: {
                FOCUS_C: '모드 한국어',
            },
            l_english: {
                FOCUS_D: 'Workspace English',
            },
        };

        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_A', 'ko', globalIndex, workspaceIndex), '한국어 이름');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_B', 'ko', globalIndex, workspaceIndex), 'English Fallback');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_C', 'ko', globalIndex, workspaceIndex), '모드 한국어');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_D', 'ja', globalIndex, workspaceIndex), 'Workspace English');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_UNKNOWN', 'ko', globalIndex, workspaceIndex), 'FOCUS_UNKNOWN');
    });
});
