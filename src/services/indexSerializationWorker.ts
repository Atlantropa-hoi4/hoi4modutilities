import { createHash } from 'node:crypto';
import { parentPort } from 'node:worker_threads';
import {
    indexCacheHeaderBytes, indexCacheMagic, indexCloneSize, isIndexFingerprint, isIndexSnapshot,
    maxIndexCacheBytes, maxIndexPayloadBytes,
} from './indexSerializationProtocol';
import type { IndexSerializationReply, IndexSerializationRequest } from './indexSerializationProtocol';

if (!parentPort) { throw new Error('Index serialization requires a worker thread.'); }
const port = parentPort;
port.on('message', (request: IndexSerializationRequest) => {
    const reply: IndexSerializationReply = { id: request.id };
    try {
        if (!isIndexFingerprint(request.fingerprint)) { throw new Error('Invalid fingerprint.'); }
        if (request.kind === 'encode') {
            if (!isIndexSnapshot(request.value)) { throw new Error('Invalid snapshot.'); }
            const json = JSON.stringify(request.value);
            const length = Buffer.byteLength(json);
            if (length > maxIndexPayloadBytes) { throw new Error('Oversized snapshot.'); }
            // Standalone output storage is transferable; no pooled Buffer or caller buffer
            // is detached. Encode the JSON directly into its final payload location.
            const buffer = Buffer.allocUnsafeSlow(indexCacheHeaderBytes + length);
            buffer.write(json, indexCacheHeaderBytes, length, 'utf8');
            const checksum = createHash('sha256').update(buffer.subarray(indexCacheHeaderBytes)).digest('hex');
            buffer.write(`${indexCacheMagic}${request.fingerprint}\n${checksum}\n`, 0, indexCacheHeaderBytes, 'ascii');
            reply.result = { kind: 'encode', bytes: new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) };
            port.postMessage(reply, [buffer.buffer]);
            return;
        }
        if (request.kind !== 'decode' || !(request.bytes instanceof Uint8Array)
            || request.bytes.byteLength < indexCacheHeaderBytes || request.bytes.byteLength > maxIndexCacheBytes
            || request.bytes.byteLength - indexCacheHeaderBytes > maxIndexPayloadBytes) { throw new Error('Invalid cache size.'); }
        const buffer = Buffer.from(request.bytes.buffer, request.bytes.byteOffset, request.bytes.byteLength);
        const header = buffer.toString('utf8', 0, indexCacheHeaderBytes);
        const lines = header.split('\n');
        if (lines.length !== 4 || `${lines[0]}\n` !== indexCacheMagic || lines[1] !== request.fingerprint
            || !isIndexFingerprint(lines[2]) || lines[3] !== '') { throw new Error('Invalid cache header.'); }
        const payload = buffer.subarray(indexCacheHeaderBytes);
        if (createHash('sha256').update(payload).digest('hex') !== lines[2]) { throw new Error('Invalid checksum.'); }
        // Reject invalid UTF8 instead of silently replacing bytes in an otherwise valid hash.
        const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payload));
        if (!isIndexSnapshot(value) || indexCloneSize(value) === undefined) { throw new Error('Invalid snapshot.'); }
        reply.result = { kind: 'decode', value };
    } catch { /* Invalid and oversized cache entries are misses, never fabricated snapshots. */ }
    port.postMessage(reply);
});
