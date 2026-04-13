import * as assert from 'assert';
import Module = require('module');

const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
nodeModule._load = function(request: string, parent: NodeModule | undefined, isMain: boolean) {
    if (request === 'vscode') {
        return {
            commands: {
                registerCommand: () => ({ dispose() {} }),
            },
            workspace: {},
            window: {},
            Uri: {
                joinPath: () => undefined,
            },
            Position: class {},
            Range: class {},
            WorkspaceEdit: class {},
        };
    }

    if (request.endsWith('/i18n') || request === './i18n') {
        return {
            localize: (_key: string, message: string, ...args: unknown[]) =>
                message.replace(/\{(\d+)\}/g, (_, index) => String(args[Number(index)] ?? '')),
        };
    }

    return originalLoad.call(this, request, parent, isMain);
};

const {
    buildShineUpdatePlan,
    deriveShineTargetRelativePath,
    deriveSourceRelativePathFromShine,
    extractShineSpriteCandidates,
    isGoalsLikeGfxPath,
    isGoalsLikeSourceGfxPath,
    isShineGfxPath,
} = require('../../src/util/focusGfxShine') as typeof import('../../src/util/focusGfxShine');

describe('focus GFX shine utility', () => {
    const sourceLabel = 'interface/sample.gfx';
    const targetLabel = 'interface/sample_shine.gfx';
    const sourceContent = `spriteTypes = {
    spriteType = {
        name = "GFX_sample_sprite"
        texturefile = "gfx/interface/missing.dds"
        noOfFrames = 1
    }
}
`;

    it('derives the shine target path from a source gfx file', () => {
        assert.strictEqual(deriveShineTargetRelativePath('interface/goals.gfx'), 'interface/goals_shine.gfx');
        assert.strictEqual(deriveShineTargetRelativePath('interface/focuses/custom.gfx'), 'interface/focuses/custom_shine.gfx');
    });

    it('derives the source path from a shine gfx file', () => {
        assert.strictEqual(deriveSourceRelativePathFromShine('interface/goals_shine.gfx'), 'interface/goals.gfx');
        assert.strictEqual(deriveSourceRelativePathFromShine('interface/focuses/custom_shine.gfx'), 'interface/focuses/custom.gfx');
    });

    it('detects shine gfx file names', () => {
        assert.strictEqual(isShineGfxPath('interface/goals_shine.gfx'), true);
        assert.strictEqual(isShineGfxPath('interface/goals.gfx'), false);
    });

    it('detects goals-like gfx files beyond exact goals.gfx', () => {
        assert.strictEqual(isGoalsLikeGfxPath('interface/goals.gfx'), true);
        assert.strictEqual(isGoalsLikeGfxPath('interface/country_goals.gfx'), true);
        assert.strictEqual(isGoalsLikeGfxPath('interface/country_goals_shine.gfx'), true);
        assert.strictEqual(isGoalsLikeGfxPath('interface/sample.gfx'), false);
        assert.strictEqual(isGoalsLikeSourceGfxPath('interface/country_goals.gfx'), true);
        assert.strictEqual(isGoalsLikeSourceGfxPath('interface/country_goals_shine.gfx'), false);
    });

    it('extracts source sprite candidates while ignoring existing shine sprites', () => {
        const candidates = extractShineSpriteCandidates(`spriteTypes = {
    spriteType = {
        name = "GFX_sample_sprite"
        texturefile = "gfx/interface/missing.dds"
    }
    spriteType = {
        name = "GFX_sample_sprite_shine"
        texturefile = "gfx/interface/missing.dds"
    }
}
`, sourceLabel);

        assert.deepStrictEqual(candidates, [{
            name: 'GFX_sample_sprite',
            texturefile: 'gfx/interface/missing.dds',
        }]);
    });

    it('bootstraps a new shine target file when none exists', () => {
        const plan = buildShineUpdatePlan(sourceContent, undefined, sourceLabel, targetLabel);

        assert.strictEqual(plan.addedEntries.length, 1);
        assert.strictEqual(plan.skippedExistingCount, 0);
        assert.match(plan.content, /spriteTypes = \{/);
        assert.match(plan.content, /name = "GFX_sample_sprite_shine"/);
        assert.match(plan.content, /animationtexturefile = "gfx\/interface\/goals\/shine_overlay\.dds"/);
    });

    it('skips shine entries that already exist in the target', () => {
        const targetContent = `spriteTypes = {
    SpriteType = {
        name = "GFX_sample_sprite_shine"
        texturefile = "gfx/interface/missing.dds"
    }
}
`;

        const plan = buildShineUpdatePlan(sourceContent, targetContent, sourceLabel, targetLabel);

        assert.strictEqual(plan.addedEntries.length, 0);
        assert.strictEqual(plan.skippedExistingCount, 1);
        assert.strictEqual(plan.content, targetContent);
    });

    it('appends a spriteTypes block when the target parses but has no spriteTypes block', () => {
        const targetContent = `guiTypes = {
    containerWindowType = {
        name = "dummy"
    }
}
`;

        const plan = buildShineUpdatePlan(sourceContent, targetContent, sourceLabel, targetLabel);

        assert.strictEqual(plan.addedEntries.length, 1);
        assert.match(plan.content, /guiTypes = \{/);
        assert.match(plan.content, /spriteTypes = \{/);
        assert.match(plan.content, /GFX_sample_sprite_shine/);
    });

    it('is idempotent when rerun against its own output', () => {
        const firstPlan = buildShineUpdatePlan(sourceContent, undefined, sourceLabel, targetLabel);
        const secondPlan = buildShineUpdatePlan(sourceContent, firstPlan.content, sourceLabel, targetLabel);

        assert.strictEqual(secondPlan.addedEntries.length, 0);
        assert.strictEqual(secondPlan.skippedExistingCount, 1);
        assert.strictEqual(secondPlan.content, firstPlan.content);
    });
});
