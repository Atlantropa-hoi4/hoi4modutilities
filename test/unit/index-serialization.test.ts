import * as assert from 'assert';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { IndexSerializationService } from '../../src/services/indexSerialization';
import { indexCacheHeaderBytes, indexCacheMagic, maxIndexCacheBytes, maxIndexCloneBytes } from '../../src/services/indexSerializationProtocol';
import { isEventIndexSnapshot, isFocusIndexSnapshot, isGfxIndexSnapshot, isLocalisationIndexSnapshot } from '../../src/services/indexSnapshotValidation';
import { applyFocusFileToIndex, createEmptyFocusIndexState, findFileByFocusKeyInIndex } from '../../src/util/sharedFocusIndexState';

const fingerprint = createHash('sha256').update('snapshot source').digest('hex');
const workerPath = path.resolve(__dirname, '../../../dist/index-serialization-worker.js');

async function encoded(service: IndexSerializationService, value: unknown): Promise<Uint8Array> {
    const result = await service.run({ kind: 'encode', fingerprint, value });
    assert.strictEqual(result?.kind, 'encode');
    if (result?.kind !== 'encode') { throw new Error('Missing encoded snapshot.'); }
    return result.bytes;
}

function cacheBytes(payload: string): Uint8Array {
    const checksum = createHash('sha256').update(payload).digest('hex');
    return Buffer.from(`${indexCacheMagic}${fingerprint}\n${checksum}\n${payload}`, 'utf8');
}

describe('index serialization worker', () => {
    it('roundtrips real key/value snapshots, Unicode and JSON escaping without nested serialization or detaching input', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const snapshot = { index: { '한글\\\"key\n': { l_korean: '안녕 🌏\t\r\n"\\\u0000', l_english: 'line\u2028separator' } },
                fileIndexes: { 'localisation/test_l_korean.yml': { l_korean: { id: '문자열' } } } };
            const bytes = await encoded(service, snapshot);
            assert.strictEqual(Buffer.from(bytes).subarray(indexCacheHeaderBytes).toString(), JSON.stringify(snapshot));
            const before = bytes.slice();
            const result = await service.run({ kind: 'decode', fingerprint, bytes });
            assert.deepStrictEqual(result, { kind: 'decode', value: snapshot });
            assert.deepStrictEqual(bytes, before, 'decoder must not detach or mutate the caller buffer');
            assert.strictEqual(snapshot.index['한글\\\"key\n'].l_korean, '안녕 🌏\t\r\n"\\\u0000');
        } finally { service.dispose(); }
    });

    it('roundtrips the event builder null-prototype dictionary and narrows real target snapshot shapes', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const index: Record<string, string> = Object.create(null);
            index['namespace.1'] = 'events/sample.txt';
            index['__proto__'] = 'events/proto.txt';
            index['constructor'] = 'events/constructor.txt';
            const event = await service.run({ kind: 'decode', fingerprint, bytes: await encoded(service, { index }) });
            if (event?.kind !== 'decode' || !isEventIndexSnapshot(event.value)) { throw new Error('Real event snapshot was rejected.'); }
            assert.strictEqual(event.value.index['namespace.1'], 'events/sample.txt');
            assert.strictEqual(event.value.index['__proto__'], 'events/proto.txt');
            assert.strictEqual(event.value.index['constructor'], 'events/constructor.txt');
            assert.strictEqual(Object.getPrototypeOf(index), null, 'encoding must not mutate the original dictionary');
            assert.strictEqual(Object.hasOwn(event.value.index, '__proto__'), true);

            const focusIndex = createEmptyFocusIndexState();
            focusIndex.byFile = Object.create(null);
            focusIndex.byId = Object.create(null);
            applyFocusFileToIndex(focusIndex, 'common/national_focus/sample.txt', ['focus.one', 'focus.two']);
            const focus = await service.run({ kind: 'decode', fingerprint, bytes: await encoded(service, { index: focusIndex }) });
            if (focus?.kind !== 'decode' || !isFocusIndexSnapshot(focus.value)) { throw new Error('Real focus snapshot was rejected.'); }
            assert.strictEqual(findFileByFocusKeyInIndex(focus.value.index, 'focus.two'), 'common/national_focus/sample.txt');

            const gfxIndex: Record<string, { file: string } | undefined> = Object.create(null);
            gfxIndex.GFX_sample = { file: 'interface/sample.gfx' };
            gfxIndex.missing = undefined;
            const gfx = await service.run({ kind: 'decode', fingerprint, bytes: await encoded(service, { index: gfxIndex, dlcIndex: undefined }) });
            if (gfx?.kind !== 'decode' || !isGfxIndexSnapshot(gfx.value)) { throw new Error('Real GFX snapshot was rejected.'); }
            assert.deepStrictEqual(gfx.value.index.GFX_sample, { file: 'interface/sample.gfx' });
            assert.strictEqual(Object.hasOwn(gfx.value.index, 'missing'), false, 'JSON omits undefined object entries');
            assert.strictEqual(Object.hasOwn(gfx.value, 'dlcIndex'), false);

            const localisation = { index: { l_korean: { key: '번역' } },
                fileIndexes: { 'localisation/sample_l_korean.yml': { l_korean: { key: '번역' } } } };
            const localised = await service.run({ kind: 'decode', fingerprint, bytes: await encoded(service, localisation) });
            if (localised?.kind !== 'decode' || !isLocalisationIndexSnapshot(localised.value)) { throw new Error('Real localisation snapshot was rejected.'); }
            assert.deepStrictEqual(localised.value, localisation);
        } finally { service.dispose(); }
    });

    it('preserves JSON undefined-property and sparse-array semantics without accepting oversized sparse inputs', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const values: (string | undefined)[] = new Array(4);
            values[1] = undefined;
            values[2] = '한글';
            const snapshot = { index: { omitted: undefined, values } };
            const result = await service.run({ kind: 'decode', fingerprint, bytes: await encoded(service, snapshot) });
            assert.deepStrictEqual(result, { kind: 'decode', value: { index: { values: [null, null, '한글', null] } } });
            assert.strictEqual(Object.hasOwn(values, 0), false, 'the source sparse array must not be filled or detached');
            assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value: { index: { values: new Array(2_000_001) } } }), undefined);
        } finally { service.dispose(); }
    });

    it('rejects checksum-valid but semantically malformed persisted data at every target schema boundary', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const cases = [
                { validate: isEventIndexSnapshot, invalid: [{}, { index: [] }, { index: { id: 5 } }] },
                { validate: isGfxIndexSnapshot, invalid: [{ index: { GFX_icon: 'not an item' } }, { index: { GFX_icon: { file: 5 } } }, { index: {}, dlcIndex: [] }] },
                { validate: isFocusIndexSnapshot, invalid: [{ index: { byFile: {} } }, { index: { byFile: {}, byId: { id: [5] } } }, { index: { byFile: {}, byId: {} }, dlcIndex: null }] },
                { validate: isLocalisationIndexSnapshot, invalid: [{ index: { l_korean: 'not a dictionary' } }, { index: { l_korean: { key: 5 } } }, { index: {}, fileIndexes: { 'file.yml': { l_korean: 'invalid' } } }] },
            ];
            for (const entry of cases) {
                for (const invalid of entry.invalid) {
                    const result = await service.run({ kind: 'decode', fingerprint, bytes: cacheBytes(JSON.stringify(invalid)) });
                    if (result?.kind !== 'decode') { throw new Error('Generic checksum-valid object was not decoded.'); }
                    assert.strictEqual(entry.validate(result.value), false, 'target validation must reject malformed data, never fabricate empty state');
                }
            }
        } finally { service.dispose(); }
    });

    it('rejects corrupt bytes, wrong fingerprints, old versions, invalid UTF8/JSON and non-object snapshots', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const bytes = await encoded(service, { index: { id: 'real value' } });
            const corrupt = bytes.slice();
            corrupt[corrupt.length - 2] ^= 1;
            assert.strictEqual(await service.run({ kind: 'decode', fingerprint, bytes: corrupt }), undefined);
            assert.strictEqual(await service.run({ kind: 'decode', fingerprint: '0'.repeat(64), bytes }), undefined);
            const wrongVersion = bytes.slice();
            wrongVersion[indexCacheMagic.length - 2] = '1'.charCodeAt(0);
            assert.strictEqual(await service.run({ kind: 'decode', fingerprint, bytes: wrongVersion }), undefined);
            for (const payload of ['{', 'null', '[]', '"value"']) {
                assert.strictEqual(await service.run({ kind: 'decode', fingerprint, bytes: cacheBytes(payload) }), undefined);
            }
            const invalidUtf8 = cacheBytes('{}');
            invalidUtf8[indexCacheHeaderBytes] = 255;
            const checksum = createHash('sha256').update(invalidUtf8.subarray(indexCacheHeaderBytes)).digest('hex');
            Buffer.from(invalidUtf8.buffer, invalidUtf8.byteOffset, invalidUtf8.byteLength)
                .write(checksum, indexCacheMagic.length + 65, 64, 'ascii');
            assert.strictEqual(await service.run({ kind: 'decode', fingerprint, bytes: invalidUtf8 }), undefined);
            for (const value of [null, [], { index: { impossible: Infinity } }, { index: new Map() }]) {
                assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value }), undefined);
            }
        } finally { service.dispose(); }
    });

    it('bounds input/output before publication and rejects cyclic snapshots', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            assert.strictEqual(await service.run({ kind: 'decode', fingerprint, bytes: new Uint8Array(maxIndexCacheBytes + 1) }), undefined);
            assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value: { index: 'x'.repeat(maxIndexCloneBytes / 2) } }), undefined);
            // Escape expansion can exceed the serialized payload cap even with a bounded clone.
            assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value: { index: '\u0000'.repeat(11 * 1024 * 1024) } }), undefined);
            const cyclic: { index?: unknown } = {};
            cyclic.index = cyclic;
            assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value: cyclic }), undefined);
        } finally { service.dispose(); }
    });

    it('cancels active and queued jobs, restarts cleanly, and rejects work after disposal', async () => {
        const service = new IndexSerializationService({ workerPath });
        const activeController = new AbortController();
        const queuedController = new AbortController();
        const active = service.run({ kind: 'encode', fingerprint, value: { index: 'active' } }, activeController.signal);
        const queued = service.run({ kind: 'encode', fingerprint, value: { index: 'queued' } }, queuedController.signal);
        const activeRejected = assert.rejects(active, { name: 'AbortError' });
        const queuedRejected = assert.rejects(queued, { name: 'AbortError' });
        queuedController.abort();
        activeController.abort();
        await Promise.all([activeRejected, queuedRejected]);
        assert.ok(await encoded(service, { index: { current: 'after cancellation' } }));
        const pending = service.run({ kind: 'encode', fingerprint, value: { index: 'dispose' } });
        const rejected = assert.rejects(pending, { name: 'AbortError' });
        service.dispose();
        await rejected;
        await assert.rejects(service.run({ kind: 'encode', fingerprint, value: { index: 'after dispose' } }), { name: 'AbortError' });
        await assert.rejects(service.run({ kind: 'decode', fingerprint, bytes: new Uint8Array() }, activeController.signal), { name: 'AbortError' });
    });

    it('bounds queued jobs and treats worker startup failures as cache misses', async () => {
        const service = new IndexSerializationService({ workerPath });
        try {
            const jobs = Array.from({ length: 3 }, (_, index) => service.run({ kind: 'encode', fingerprint, value: { index } }));
            assert.strictEqual(await service.run({ kind: 'encode', fingerprint, value: { index: 'overflow' } }), undefined);
            assert.ok((await Promise.all(jobs)).every(result => result?.kind === 'encode'));
        } finally { service.dispose(); }
        const unavailable = new IndexSerializationService({ workerPath: path.join(workerPath, 'missing.js') });
        try {
            assert.strictEqual(await unavailable.run({ kind: 'encode', fingerprint, value: { index: 'value' } }), undefined);
        } finally { unavailable.dispose(); }
    });
});
