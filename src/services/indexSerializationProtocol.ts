export const maxIndexCacheBytes = 64 * 1024 * 1024;
export const maxIndexPayloadBytes = 60 * 1024 * 1024;
export const maxIndexCloneBytes = 128 * 1024 * 1024;
export const indexCacheMagic = 'HOI4MU-INDEX-2\n';
export const indexCacheHeaderBytes = indexCacheMagic.length + 65 + 65;

export type IndexSerializationInput =
    | { kind: 'encode'; fingerprint: string; value: unknown }
    | { kind: 'decode'; fingerprint: string; bytes: Uint8Array };
export type IndexSerializationResult =
    | { kind: 'encode'; bytes: Uint8Array }
    | { kind: 'decode'; value: Record<string, unknown> };
export type IndexSerializationRequest = IndexSerializationInput & { id: number };
export interface IndexSerializationReply {
    id: number;
    result?: IndexSerializationResult;
}

export function isIndexFingerprint(value: string): boolean {
    return /^[a-f0-9]{64}$/.test(value);
}

export function isIndexSnapshot(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === 'object' && !Array.isArray(value)
        && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

// Bound structured-clone input before posting it. This is a traversal, not a JSON/UTF8
// encoding: cloning still costs host CPU and memory, and is deliberately not claimed free.
export function indexCloneSize(value: unknown): number | undefined {
    const seen = new WeakSet<object>();
    let size = 0;
    let nodes = 0;
    function visit(current: unknown, depth: number): boolean {
        if (++nodes > 2_000_000 || depth > 128) { return false; }
        if (current === undefined) { size += 8; }
        else if (typeof current === 'string') { size += current.length * 2 + 8; }
        else if (current === null || typeof current === 'boolean' || typeof current === 'number') {
            if (typeof current === 'number' && !Number.isFinite(current)) { return false; }
            size += 8;
        } else if (typeof current === 'object') {
            if (!current || seen.has(current) || (!Array.isArray(current) && !isIndexSnapshot(current))) { return false; }
            seen.add(current);
            size += 32;
            // JSON emits null for every sparse/undefined array slot. Bound array length,
            // not just enumerable keys, before JSON.stringify can expand the payload.
            if (Array.isArray(current)) {
                if (current.length > 2_000_000 - nodes) { return false; }
                size += current.length * 8;
            }
            for (const key in current) {
                if (!Object.hasOwn(current, key)) { continue; }
                size += key.length * 2 + 16;
                if (size > maxIndexCloneBytes) { return false; }
                const entry: unknown = Reflect.get(current, key);
                if (!visit(entry, depth + 1)) { return false; }
            }
            seen.delete(current);
        } else { return false; }
        return size <= maxIndexCloneBytes;
    }
    return isIndexSnapshot(value) && visit(value, 0) ? size : undefined;
}
