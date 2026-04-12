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
    it('prefers workspace overrides before vanilla in both requested-language and english fallback lookups', () => {
        const globalIndex = {
            l_korean: {
                FOCUS_A: '바닐라 한국어',
                FOCUS_OVERRIDE: '바닐라 한국어 오버라이드',
            },
            l_english: {
                FOCUS_A: 'Vanilla English',
                FOCUS_B: 'Vanilla English Fallback',
                FOCUS_FALLBACK_OVERRIDE: 'Vanilla English Override',
            },
        };
        const workspaceIndex = {
            l_korean: {
                FOCUS_C: '모드 한국어',
                FOCUS_OVERRIDE: '모드 한국어 오버라이드',
            },
            l_english: {
                FOCUS_D: 'Workspace English',
                FOCUS_FALLBACK_OVERRIDE: 'Workspace English Override',
            },
        };

        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_A', 'ko', globalIndex, workspaceIndex), '바닐라 한국어');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_OVERRIDE', 'ko', globalIndex, workspaceIndex), '모드 한국어 오버라이드');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_B', 'ko', globalIndex, workspaceIndex), 'Vanilla English Fallback');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_C', 'ko', globalIndex, workspaceIndex), '모드 한국어');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_D', 'ja', globalIndex, workspaceIndex), 'Workspace English');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_FALLBACK_OVERRIDE', 'ja', globalIndex, workspaceIndex), 'Workspace English Override');
        assert.strictEqual(resolveLocalisedTextFromIndex('FOCUS_UNKNOWN', 'ko', globalIndex, workspaceIndex), 'FOCUS_UNKNOWN');
    });
});
