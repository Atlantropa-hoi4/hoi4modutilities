import { open, FileHandle } from 'fs/promises';
import { inflateRaw } from 'zlib';

export interface ZipEntry {
    entryName: string;
    isDirectory: boolean;
    offset: number;
    compressed: number;
    size: number;
    method: number;
    flags: number;
    crc: number;
}

const entryLimit = 512 * 1024 * 1024;
const directoryLimit = 64 * 1024 * 1024;
const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit++) { crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return crc >>> 0;
});
export function zipCrc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) { crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255]; }
    return (crc ^ 0xffffffff) >>> 0;
}

function check(condition: boolean, message: string): asserts condition {
    if (!condition) { throw new Error(`Invalid or unsupported ZIP: ${message}`); }
}
function uint64(buffer: Buffer, offset: number): number {
    check(offset >= 0 && offset + 8 <= buffer.length, 'truncated ZIP64 field');
    const value = buffer.readBigUInt64LE(offset);
    check(value <= BigInt(Number.MAX_SAFE_INTEGER), 'offset exceeds safe integer range');
    return Number(value);
}
async function readRange(file: FileHandle, position: number, length: number, bound: number): Promise<Buffer> {
    check(Number.isSafeInteger(position) && position >= 0 && Number.isSafeInteger(length) && length >= 0
        && position + length <= bound, 'read outside archive');
    const buffer = Buffer.alloc(length);
    let offset = 0;
    while (offset < length) {
        const { bytesRead } = await file.read(buffer, offset, length - offset, position + offset);
        check(bytesRead > 0, 'truncated data');
        offset += bytesRead;
    }
    return buffer;
}

/** Stores only the central directory; entry data is read asynchronously on demand. */
export class ZipArchive {
    private constructor(private readonly path: string, private readonly length: number,
        private readonly modified: number, private readonly directoryOffset: number,
        private readonly entries: Map<string, ZipEntry>) {}

    public static async open(path: string): Promise<ZipArchive> {
        const file = await open(path, 'r');
        try {
            const stat = await file.stat();
            check(stat.size >= 22, 'missing end record');
            const tailStart = Math.max(0, stat.size - 65557);
            const tail = await readRange(file, tailStart, stat.size - tailStart, stat.size);
            let end = -1;
            for (let i = tail.length - 22; i >= 0; i--) {
                if (tail.readUInt32LE(i) === 0x06054b50 && i + 22 + tail.readUInt16LE(i + 20) === tail.length) { end = i; break; }
            }
            check(end >= 0, 'missing end record');
            check(tail.readUInt16LE(end + 4) === 0 && tail.readUInt16LE(end + 6) === 0, 'split archive');
            let count = tail.readUInt16LE(end + 10);
            check(tail.readUInt16LE(end + 8) === count, 'split directory');
            let size = tail.readUInt32LE(end + 12);
            let offset = tail.readUInt32LE(end + 16);
            let directoryBound = tailStart + end;
            if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
                const locator = await readRange(file, directoryBound - 20, 20, stat.size);
                check(locator.readUInt32LE(0) === 0x07064b50 && locator.readUInt32LE(4) === 0 && locator.readUInt32LE(16) === 1, 'ZIP64 locator');
                const recordOffset = uint64(locator, 8);
                const record = await readRange(file, recordOffset, 56, directoryBound - 20);
                check(record.readUInt32LE(0) === 0x06064b50 && uint64(record, 4) >= 44, 'ZIP64 end record');
                check(record.readUInt32LE(16) === 0 && record.readUInt32LE(20) === 0, 'split ZIP64 archive');
                count = uint64(record, 32);
                check(uint64(record, 24) === count, 'split ZIP64 directory');
                size = uint64(record, 40);
                offset = uint64(record, 48);
                directoryBound = recordOffset;
            }
            check(size <= directoryLimit && count <= 1000000, 'directory limit exceeded');
            const directory = await readRange(file, offset, size, directoryBound);
            const entries = new Map<string, ZipEntry>();
            let cursor = 0;
            for (let i = 0; i < count; i++) {
                check(cursor + 46 <= directory.length && directory.readUInt32LE(cursor) === 0x02014b50, 'central header');
                const nameLength = directory.readUInt16LE(cursor + 28);
                const extraLength = directory.readUInt16LE(cursor + 30);
                const endEntry = cursor + 46 + nameLength + extraLength + directory.readUInt16LE(cursor + 32);
                check(endEntry <= directory.length, 'central entry length');
                let disk = directory.readUInt16LE(cursor + 34);
                const entry: ZipEntry = {
                    entryName: directory.toString('utf8', cursor + 46, cursor + 46 + nameLength),
                    isDirectory: false, flags: directory.readUInt16LE(cursor + 8), method: directory.readUInt16LE(cursor + 10),
                    crc: directory.readUInt32LE(cursor + 16), compressed: directory.readUInt32LE(cursor + 20),
                    size: directory.readUInt32LE(cursor + 24), offset: directory.readUInt32LE(cursor + 42),
                };
                const extraEnd = cursor + 46 + nameLength + extraLength;
                for (let extra = cursor + 46 + nameLength; extra < extraEnd;) {
                    check(extra + 4 <= extraEnd, 'extra header');
                    const field = directory.readUInt16LE(extra);
                    const next = extra + 4 + directory.readUInt16LE(extra + 2);
                    check(next <= extraEnd, 'extra field length');
                    if (field === 1) {
                        const values = directory.subarray(extra + 4, next);
                        let p = 0;
                        if (entry.size === 0xffffffff) { entry.size = uint64(values, p); p += 8; }
                        if (entry.compressed === 0xffffffff) { entry.compressed = uint64(values, p); p += 8; }
                        if (entry.offset === 0xffffffff) { entry.offset = uint64(values, p); p += 8; }
                        if (disk === 0xffff) { check(p + 4 <= values.length, 'ZIP64 disk'); disk = values.readUInt32LE(p); }
                    }
                    extra = next;
                }
                check(disk === 0 && entry.offset < offset && entry.size !== 0xffffffff && entry.compressed !== 0xffffffff, 'entry bounds');
                entry.isDirectory = /[\\/]$/.test(entry.entryName);
                entries.set(entry.entryName, entry);
                cursor = endEntry;
            }
            return new ZipArchive(path, stat.size, stat.mtimeMs, offset, entries);
        } finally { await file.close(); }
    }

    public getEntries(): ZipEntry[] { return [...this.entries.values()]; }
    public get estimatedBytes(): number {
        return [...this.entries.values()].reduce((size, entry) => size + 160 + entry.entryName.length * 2, 0);
    }
    public getEntry(name: string): ZipEntry | null { return this.entries.get(name) ?? null; }

    public async readEntry(name: string): Promise<Buffer> {
        const entry = this.entries.get(name);
        check(!!entry && !entry.isDirectory, 'entry not found');
        check((entry.flags & 0x41) === 0 && (entry.method === 0 || entry.method === 8), 'encryption or compression method');
        check(entry.size <= entryLimit && entry.compressed <= entryLimit, 'entry size limit exceeded');
        const file = await open(this.path, 'r');
        try {
            const stat = await file.stat();
            check(stat.size === this.length && stat.mtimeMs === this.modified, 'archive changed; reload required');
            const header = await readRange(file, entry.offset, 30, this.directoryOffset);
            check(header.readUInt32LE(0) === 0x04034b50 && header.readUInt16LE(8) === entry.method
                && header.readUInt16LE(6) === entry.flags, 'local header mismatch');
            const nameLength = header.readUInt16LE(26);
            const localName = await readRange(file, entry.offset + 30, nameLength, this.directoryOffset);
            check(localName.toString('utf8') === name, 'local name mismatch');
            const data = await readRange(file, entry.offset + 30 + nameLength + header.readUInt16LE(28), entry.compressed, this.directoryOffset);
            const decoded = entry.method === 0 ? data : await new Promise<Buffer>((resolve, reject) => {
                inflateRaw(data, { maxOutputLength: Math.max(1, entry.size) }, (error, result) => error ? reject(error) : resolve(result));
            });
            check(decoded.length === entry.size && zipCrc32(decoded) === entry.crc, 'size or checksum mismatch');
            return decoded;
        } finally { await file.close(); }
    }
}
