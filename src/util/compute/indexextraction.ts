import { parseHoi4File } from '../../hoiformat/hoiparser';
import { getSpriteTypes } from '../../hoiformat/spritetype';
import { extractFocusIds } from '../../previewdef/focustree/focustreeschematypes';
import { incrementPerfCounter, measureAsync, measureSync } from '../perf';
import type { ScriptIndexInput } from './protocol';
import { tryRustCompute } from './service';

/** Index-only fast path; rejection always replays the complete existing parser oracle. */
export async function extractScriptIndex(
    kind: ScriptIndexInput['kind'], bytes: Uint8Array, errorMessagePrefix = '', signal?: AbortSignal,
): Promise<string[]> {
    signal?.throwIfAborted();
    const result = await measureAsync('index.parse', { kind, engine: 'rust-wasm', inputBytes: bytes.byteLength },
        () => tryRustCompute({ kind, bytes }, signal));
    signal?.throwIfAborted();
    if (result) { return result.entries; }
    incrementPerfCounter('index.parse.fallback', { kind });
    return measureSync('index.parse.cpu', { kind, engine: 'typescript', inputBytes: bytes.byteLength }, () => {
        const node = parseHoi4File(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('utf8'), errorMessagePrefix, { keepTokens: false });
        return kind === 'focus-index' ? extractFocusIds(node) : getSpriteTypes(node).map(sprite => sprite.name);
    });
}
