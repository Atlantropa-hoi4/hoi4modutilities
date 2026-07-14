import { UserError } from '../../common';

export interface BMP {
    width: number;
    height: number;
    bitsPerPixel: number;
    bytesPerRow: number;
    data: Uint8Array;
}

export function parseBmp(buffer: ArrayBuffer, byteOffset: number, byteLength: number = buffer.byteLength - byteOffset): BMP {
    const endOffset = byteOffset + byteLength;
    if (!Number.isSafeInteger(byteOffset) || !Number.isSafeInteger(byteLength) ||
        byteOffset < 0 || byteLength < 0 || endOffset > buffer.byteLength || byteLength < 18) {
        throw new UserError('BMP header is truncated.');
    }

    const uint8Buffer = new Uint8Array(buffer, byteOffset, byteLength);
    if (uint8Buffer[0] !== 0x42 || uint8Buffer[1] !== 0x4D) {
        throw new UserError("Bmp not starts with 'BM'");
    }

    const bmpHeader = new DataView(buffer, 2 + byteOffset, 4 << 2);
    const relativeDataOffset = bmpHeader.getUint32(2 << 2, true);

    const dibHeaderLength = bmpHeader.getUint32(3 << 2, true);
    const dibViewLength = dibHeaderLength;
    if (dibHeaderLength < 16 || 0xE + dibViewLength > byteLength || relativeDataOffset < 0xE + dibViewLength) {
        throw new UserError('BMP DIB header is truncated.');
    }
    const dibHeader = new DataView(buffer, 0xE + byteOffset, dibViewLength);

    const width = dibHeader.getUint32(1 << 2, true);
    const height = dibHeader.getUint32(2 << 2, true);
    const bitsPerPixel = dibHeader.getUint16(7 << 1, true);

    const bytesPerRow = Math.ceil(width * bitsPerPixel / 32) * 4;
    const dataLength = bytesPerRow * height;
    if (!Number.isSafeInteger(dataLength) || dataLength < 0 ||
        relativeDataOffset > byteLength || dataLength > byteLength - relativeDataOffset) {
        throw new UserError('BMP pixel data is truncated.');
    }

    return {
        width,
        height,
        bitsPerPixel,
        bytesPerRow,
        data: new Uint8Array(buffer, byteOffset + relativeDataOffset, dataLength),
    };
}
