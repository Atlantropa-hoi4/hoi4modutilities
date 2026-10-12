import * as assert from 'assert';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Module = require('module');
import { parseHoi4File } from '../../src/hoiformat/hoiparser';
import { getSpriteTypes } from '../../src/hoiformat/spritetype';
import { RustWasmCompute, ComputeInputRejectedError } from '../../src/util/compute/wasm';
import { RustComputeService, registerRustCompute } from '../../src/util/compute/service';
import type { ScriptIndexInput } from '../../src/util/compute/protocol';
import type { extractFocusIds as FocusIdExtractor } from '../../src/previewdef/focustree/focustreeschematypes';
import type { extractScriptIndex as ScriptIndexExtractor } from '../../src/util/compute/indexextraction';
import { applyFocusFileToIndex, createEmptyFocusIndexState, findFileByFocusKeyInLayeredIndexes } from '../../src/util/sharedFocusIndexState';
import { readFixture } from '../testUtils';

const root = path.resolve(__dirname, '../../..');
const workerPath = path.join(root, 'dist', 'compute-worker.js');
const wasmPath = path.join(root, 'dist', 'hoi4_compute.wasm');
const nodeModule = Module as typeof Module & { _load: (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown };
const originalLoad = nodeModule._load;
let extractFocusIds: typeof FocusIdExtractor;
let extractScriptIndex: typeof ScriptIndexExtractor;

const focusScripts = [
    '\ufeff# shared_focus = { id = COMMENT }\nJOINT_FOCUS = { id = JOINT } shared_focus = { id = SHARED } focus_tree = { focus = { id = LOCAL } shared_focus = REFERENCE } unrelated = { shared_focus = { id = NESTED } }',
    'shared_focus { id = FIRST ID = LAST } joint_focus = { id = DUP } shared_focus = { id = DUP } shared_focus = { id = "" }',
    '@id = "CONSTANT" shared_focus = { id = @id } @id = 0x2a joint_focus = { id = @id } shared_focus = { id = @missing }',
    String.raw`shared_focus = { id = "QUOTE\"AND\\SLASH" text = "#not_comment { }" completion_reward = { log = "ignored" } }`,
    'shared_focus = { id = 12 } shared_focus = { id = -0 } joint_focus = { id = 20% }',
];
const gfxScripts = [
    '\ufeffSpriteTypes = { progressbartype = { name = PROGRESS texturefile1 = a texturefile2 = b } CorneredTileSpriteType = { name = CORNER texturefile = a } textSpriteType = { name = TEXT texturefile = a } frameAnimatedSpriteType = { name = ANIMATED texturefile = a } spriteType = { name = SPRITE texturefile = a } }',
    'spritetypes = { spritetype = { name = NO_TEXTURE } spritetype = { name = INVALID texturefile = "" } progressbartype = { name = MISSING_SECOND texturefile1 = a } spritetype = { name = FIRST name = LAST texturefile = a } } spritetypes = { spritetype = { name = SECOND texturefile = a } }',
    '@name = "ROOT" @texture = "a.dds" spritetypes = { spritetype = { name = @name texturefile = @texture } spritetype = { name = 12 texturefile = a } spritetype = { name = SYMBOL texturefile = rgb { 1 2 3 } } } unrelated = { spritetypes = { spritetype = { name = NESTED texturefile = a } } }',
    String.raw`spritetypes = { spriteType = { name = "GFX_\"quote\\path" texturefile = "gfx/a.dds" # comment
        } spritetype = { name = DUP texturefile = a } spritetype = { name = DUP texturefile = b } }`,
];

function oracle(kind: ScriptIndexInput['kind'], source: string): string[] {
    const node = parseHoi4File(source, '', { keepTokens: false });
    return kind === 'focus-index' ? extractFocusIds(node) : getSpriteTypes(node).map(sprite => sprite.name);
}

describe('shipped Rust script index extraction', function() {
    this.timeout(30_000);
    let wasm: RustWasmCompute;
    before(async () => {
        nodeModule._load = function(request, parent, isMain) {
            if (request === 'vscode') { return { workspace: { getConfiguration: () => ({ featureFlags: [] }) } }; }
            return originalLoad.call(nodeModule, request, parent, isMain);
        };
        try {
            ({ extractFocusIds } = require('../../src/previewdef/focustree/focustreeschematypes'));
            ({ extractScriptIndex } = require('../../src/util/compute/indexextraction'));
        } finally { nodeModule._load = originalLoad; }
        wasm = await RustWasmCompute.create(await fs.readFile(wasmPath));
    });

    it('matches the actual focus schema including local exclusion, order, duplicates and constants', () => {
        for (const source of focusScripts) {
            assert.deepStrictEqual(wasm.compute({ kind: 'focus-index', bytes: Buffer.from(source) }).entries, oracle('focus-index', source));
        }
        assert.deepStrictEqual(wasm.compute({ kind: 'focus-index', bytes: Buffer.from(focusScripts[0]) }).entries, ['SHARED', 'JOINT']);
    });

    it('matches validated GFX names, category/container ordering and required textures', () => {
        for (const source of gfxScripts) {
            assert.deepStrictEqual(wasm.compute({ kind: 'gfx-index', bytes: Buffer.from(source) }).entries, oracle('gfx-index', source));
        }
        assert.deepStrictEqual(wasm.compute({ kind: 'gfx-index', bytes: Buffer.from(gfxScripts[0]) }).entries, ['SPRITE', 'ANIMATED', 'TEXT', 'CORNER', 'PROGRESS']);
    });

    it('matches repository focus/GFX fixtures without building full ASTs in the fast path', () => {
        const fixtures: Array<[ScriptIndexInput['kind'], string]> = [
            ['focus-index', readFixture('focus', 'modern-focuses.txt')],
            ['gfx-index', readFixture('workspace', 'interface', 'sample.gfx')],
            ['gfx-index', readFixture('workspace', 'interface', 'country_goals.gfx')],
            ['gfx-index', readFixture('workspace', 'interface', 'goals.gfx')],
        ];
        for (const [kind, source] of fixtures) {
            assert.deepStrictEqual(wasm.compute({ kind, bytes: Buffer.from(source) }).entries, oracle(kind, source));
        }
    });

    it('rejects unsupported syntax atomically and preserves the real parser fallback result', async () => {
        const registration = registerRustCompute(root);
        try {
            const cases: Array<[ScriptIndexInput['kind'], string]> = [
                ['focus-index', 'shared_focus = { id = VALID } shared_focus = { @id = "NESTED" id = @id }'],
                ['focus-index', '@a = @b @b = "CHAIN" shared_focus = { id = @a }'],
                ['focus-index', '@block = { id = BLOCK } shared_focus = @block'],
                ['focus-index', 'shared_focus = { id = 1.25 }'],
                ['focus-index', 'shared_focus = { id = VALID'],
                ['focus-index', 'shared_focus = tagged { id = ATTACHED }'],
                ['gfx-index', 'spritetypes = { spritetype = { @name = "NESTED" name = @name texturefile = a } }'],
                ['gfx-index', 'spritetypes = tagged { spritetype = { name = ATTACHED texturefile = a } }'],
            ];
            for (const [kind, source] of cases) {
                assert.throws(() => wasm.compute({ kind, bytes: Buffer.from(source) }), ComputeInputRejectedError);
                assert.deepStrictEqual(await extractScriptIndex(kind, Buffer.from(source)), oracle(kind, source));
            }
            await assert.rejects(extractScriptIndex('focus-index', Buffer.from('shared_focus = { id = }')), /Expect string, number, symbol, or/);
        } finally { registration.dispose(); }
    });

    it('retains parser behavior when the WASM infrastructure is missing', async () => {
        const service = new RustComputeService({ workerPath, wasmPath: `${wasmPath}.missing` });
        try {
            assert.strictEqual(await service.run({ kind: 'focus-index', bytes: Buffer.from(focusScripts[0]) }), undefined);
            assert.strictEqual(await service.run({ kind: 'gfx-index', bytes: Buffer.from(gfxScripts[0]) }), undefined);
        } finally { service.dispose(); }
        assert.deepStrictEqual(await extractScriptIndex('focus-index', Buffer.from(focusScripts[0])), oracle('focus-index', focusScripts[0]));
    });

    it('indexes extracted IDs with workspace/DLC/base precedence and replacement semantics', () => {
        const layers = [createEmptyFocusIndexState(), createEmptyFocusIndexState(), createEmptyFocusIndexState()];
        for (const [index, file, source] of [
            [2, 'base.txt', 'shared_focus = { id = SHARED } joint_focus = { id = BASE_ONLY }'],
            [1, 'dlc.txt', 'joint_focus = { id = SHARED } shared_focus = { id = DLC_ONLY }'],
            [0, 'mod.txt', 'shared_focus = { id = SHARED } focus_tree = { focus = { id = BASE_ONLY } }'],
        ] as const) {
            applyFocusFileToIndex(layers[index], file, wasm.compute({ kind: 'focus-index', bytes: Buffer.from(source) }).entries);
        }
        assert.strictEqual(findFileByFocusKeyInLayeredIndexes(layers, 'SHARED'), 'mod.txt');
        assert.strictEqual(findFileByFocusKeyInLayeredIndexes(layers, 'DLC_ONLY'), 'dlc.txt');
        assert.strictEqual(findFileByFocusKeyInLayeredIndexes(layers, 'BASE_ONLY'), 'base.txt');
        applyFocusFileToIndex(layers[0], 'mod.txt', wasm.compute({ kind: 'focus-index', bytes: Buffer.from('shared_focus = { id = REPLACED }') }).entries);
        assert.strictEqual(findFileByFocusKeyInLayeredIndexes(layers, 'SHARED'), 'dlc.txt');
    });

    it('bounds queued script work and rejects pre-aborted reads without publishing an index', async () => {
        const service = new RustComputeService({ workerPath, wasmPath });
        try {
            const jobs = Array.from({ length: 10 }, () => service.run({ kind: 'focus-index', bytes: Buffer.from(focusScripts[0]) }));
            assert.strictEqual(await jobs[9], undefined, 'overflow must fall back, not retain an unbounded queue');
            const results = await Promise.all(jobs.slice(0, 9));
            assert.ok(results.every(result => result?.entries.join(',') === 'SHARED,JOINT'));
            const controller = new AbortController();
            controller.abort();
            await assert.rejects(service.run({ kind: 'focus-index', bytes: Buffer.from(focusScripts[0]) }, controller.signal), { name: 'AbortError' });
            await assert.rejects(extractScriptIndex('focus-index', Buffer.from(focusScripts[0]), '', controller.signal), { name: 'AbortError' });
        } finally { service.dispose(); }
    });

    it('cancels active and queued scripts and resumes image and script work on a new worker', async () => {
        const service = new RustComputeService({ workerPath, wasmPath, minimumPixels: 0 });
        try {
            const active = new AbortController();
            const queued = new AbortController();
            const first = service.run({ kind: 'focus-index', bytes: Buffer.from('shared_focus = { id = ACTIVE }') }, active.signal);
            const second = service.run({ kind: 'gfx-index', bytes: Buffer.from(gfxScripts[0]) }, queued.signal);
            const rejected = [assert.rejects(first, { name: 'AbortError' }), assert.rejects(second, { name: 'AbortError' })];
            queued.abort(); active.abort();
            await Promise.all(rejected);
            const [script, image] = await Promise.all([
                service.run({ kind: 'focus-index', bytes: Buffer.from(focusScripts[0]) }),
                service.run({ kind: 'bgr', bytes: Uint8Array.of(10, 20, 30), width: 1, height: 1, stride: 3 }),
            ]);
            assert.deepStrictEqual(script?.entries, ['SHARED', 'JOINT']);
            assert.deepStrictEqual([...image!.colors], [10 | 20 << 8 | 30 << 16]);
            assert.deepStrictEqual([...image!.pixels], [10, 20, 30, 0]);
        } finally { service.dispose(); }
    });
});
