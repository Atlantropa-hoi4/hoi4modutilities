import * as assert from 'assert';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import AdmZip = require('adm-zip');
import { ZipArchive, zipCrc32 } from '../../src/util/zipArchive';

describe('random access DLC ZIP archive', () => {
    let folder: string;
    beforeEach(async () => { folder = await fs.mkdtemp(path.join(os.tmpdir(), 'hoi4mu-zip-test-')); });
    afterEach(async () => { await fs.rm(folder, { recursive: true, force: true }); });

    async function archive(data: Buffer): Promise<ZipArchive> {
        const file = path.join(folder, 'fixture.zip');
        await fs.writeFile(file, data);
        return ZipArchive.open(file);
    }
    function fixture(): Buffer {
        const zip = new AdmZip();
        zip.addFile('events/', Buffer.alloc(0));
        zip.addFile('events/a.txt', Buffer.from('event text '.repeat(300)));
        zip.addFile('gfx/empty.txt', Buffer.alloc(0));
        return zip.toBuffer();
    }
    it('lists nested entries without folder records and reads empty and deflated files concurrently', async () => {
        const zip = await archive(fixture());
        assert.ok(zip.getEntry('events/')!.isDirectory);
        assert.strictEqual(zip.getEntry('gfx/'), null);
        assert.deepStrictEqual(await Promise.all(['events/a.txt', 'gfx/empty.txt'].map(name => zip.readEntry(name))),
            [Buffer.from('event text '.repeat(300)), Buffer.alloc(0)]);
        assert.ok(zip.estimatedBytes < 4096);
    });
    it('does not read unused damaged entry data while opening or reading a different entry', async () => {
        const data = fixture();
        const first = await archive(data);
        const entry = first.getEntry('events/a.txt')!;
        const start = entry.offset + 30 + data.readUInt16LE(entry.offset + 26) + data.readUInt16LE(entry.offset + 28);
        data[start] ^= 0xff;
        const zip = await archive(data);
        assert.strictEqual((await zip.readEntry('gfx/empty.txt')).length, 0);
        await assert.rejects(zip.readEntry('events/a.txt'));
    });
    it('reads stored data and checks CRC integrity', async () => {
        const data = Buffer.from('stored');
        const name = Buffer.from('stored.txt');
        const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50); local.writeUInt32LE(zipCrc32(data), 14);
        local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
        const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50); central.writeUInt32LE(zipCrc32(data), 16);
        central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
        const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10);
        end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + data.length, 16);
        const bytes = Buffer.concat([local, name, data, central, name, end]);
        assert.deepStrictEqual(await (await archive(bytes)).readEntry('stored.txt'), data);
        bytes[30 + name.length] ^= 1;
        await assert.rejects((await archive(bytes)).readEntry('stored.txt'), /checksum/);
    });
    it('supports ZIP64 end records without allocating an archive-sized buffer', async () => {
        const data = fixture(); const end = data.subarray(-22); const offset = data.length - 22;
        const record = Buffer.alloc(56); record.writeUInt32LE(0x06064b50); record.writeBigUInt64LE(44n, 4);
        record.writeBigUInt64LE(BigInt(end.readUInt16LE(8)), 24); record.writeBigUInt64LE(BigInt(end.readUInt16LE(10)), 32);
        record.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40); record.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48);
        const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50); locator.writeBigUInt64LE(BigInt(offset), 8); locator.writeUInt32LE(1, 16);
        end.writeUInt16LE(0xffff, 8); end.writeUInt16LE(0xffff, 10); end.writeUInt32LE(0xffffffff, 12); end.writeUInt32LE(0xffffffff, 16);
        const zip = await archive(Buffer.concat([data.subarray(0, offset), record, locator, end]));
        assert.strictEqual((await zip.readEntry('events/a.txt')).toString(), 'event text '.repeat(300));
    });
    it('rejects truncated archives, missing entries, oversized output and changed files', async () => {
        await assert.rejects(archive(fixture().subarray(0, -4)));
        const data = fixture();
        const zip = await archive(data);
        await assert.rejects(zip.readEntry('absent'));
        const central = data.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
        data.writeUInt32LE(600 * 1024 * 1024, central + 24);
        const oversized = await archive(data);
        const name = oversized.getEntries()[0].entryName;
        await assert.rejects(oversized.readEntry(name));
        await fs.appendFile(path.join(folder, 'fixture.zip'), 'changed');
        await assert.rejects(zip.readEntry('events/a.txt'), /changed/);
    });
});
