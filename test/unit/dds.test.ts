import * as assert from 'assert';
import { DDS } from '../../src/util/image/dds/dds';
import { ChannelFormat, PixelValueType, RawPixelFormat } from '../../src/util/image/dds/pixelformat';
import { Surface } from '../../src/util/image/dds/surface';
import {
    DDPF_ALPHA,
    DDPF_FOURCC,
    DDPF_RGBA,
    DDSCAPS2_CUBEMAP,
    DDSCAPS2_CUBEMAP_NEGATIVEX,
    DDSCAPS2_CUBEMAP_POSITIVEX,
    DDSCAPS_MIPMAP,
    DDS_MAGIC,
    DxgiFormat,
    FOURCC_DX10,
    HEADER_DXT10_LENGTH_INT,
    HEADER_LENGTH_INT,
    ResourceDimension,
} from '../../src/util/image/dds/typedef';

describe('DDS parsing', () => {
    it('resets mip dimensions for each cubemap face and consumes each face at the correct offset', () => {
        const faceLayout = [
            { width: 4, height: 4, marker: 11 },
            { width: 2, height: 2, marker: 12 },
            { width: 4, height: 4, marker: 21 },
            { width: 2, height: 2, marker: 22 },
        ];
        const dataLength = faceLayout.reduce((sum, face) => sum + face.width * face.height * 4, 0);
        const buffer = new ArrayBuffer(HEADER_LENGTH_INT * 4 + dataLength);
        const header = new Int32Array(buffer, 0, HEADER_LENGTH_INT);
        configureRgbaHeader(header, 4, 4);
        header[7] = 2;
        header[27] = DDSCAPS_MIPMAP;
        header[28] = DDSCAPS2_CUBEMAP | DDSCAPS2_CUBEMAP_POSITIVEX | DDSCAPS2_CUBEMAP_NEGATIVEX;

        let offset = HEADER_LENGTH_INT * 4;
        for (const face of faceLayout) {
            new Uint8Array(buffer, offset, face.width * face.height * 4).fill(face.marker);
            offset += face.width * face.height * 4;
        }

        const dds = DDS.parse(buffer, 0);
        assert.deepStrictEqual(dds.images.map(image => [image.width, image.height]), [
            [4, 4],
            [2, 2],
            [4, 4],
            [2, 2],
        ]);
        assert.deepStrictEqual(dds.images.map(image => Array.from(image.getFullRgba().slice(0, 4))), [
            [11, 11, 11, 11],
            [12, 12, 12, 12],
            [21, 21, 21, 21],
            [22, 22, 22, 22],
        ]);
    });

    it('recognizes a DX10 header when the FOURCC flag is combined with another pixel-format flag', () => {
        const headerBytes = (HEADER_LENGTH_INT + HEADER_DXT10_LENGTH_INT) * 4;
        const buffer = new ArrayBuffer(headerBytes + 4);
        const header = new Int32Array(buffer, 0, HEADER_LENGTH_INT);
        header[0] = DDS_MAGIC;
        header[3] = 1;
        header[4] = 1;
        header[20] = DDPF_FOURCC | DDPF_ALPHA;
        header[21] = FOURCC_DX10;

        const dxt10Header = new Int32Array(buffer, HEADER_LENGTH_INT * 4, HEADER_DXT10_LENGTH_INT);
        dxt10Header[0] = DxgiFormat.DXGI_FORMAT_R8G8B8A8_UNORM;
        dxt10Header[1] = ResourceDimension.DDS_DIMENSION_TEXTURE2D;
        dxt10Header[3] = 1;
        new Uint8Array(buffer, headerBytes, 4).set([10, 20, 30, 40]);

        const dds = DDS.parse(buffer, 0);
        assert.deepStrictEqual(Array.from(dds.images[0].getFullRgba()), [10, 20, 30, 40]);
    });

    it('expands normalized luminance and luminance-alpha channels to 8-bit RGBA', () => {
        const luminance = new Surface(
            Uint8Array.of(128).buffer,
            0,
            1,
            'L8',
            1,
            1,
            rawFormat(ChannelFormat.l, 8, [0], [0], [8]),
        );
        const luminanceAlpha = new Surface(
            Uint8Array.of(64, 128).buffer,
            0,
            2,
            'LA8',
            1,
            1,
            rawFormat(ChannelFormat.la, 16, [0, 1], [0, 8], [8, 8]),
        );

        assert.deepStrictEqual(Array.from(luminance.getFullRgba()), [128, 128, 128, 255]);
        assert.deepStrictEqual(Array.from(luminanceAlpha.getFullRgba()), [64, 64, 64, 128]);
    });
});

function configureRgbaHeader(header: Int32Array, width: number, height: number): void {
    header[0] = DDS_MAGIC;
    header[3] = height;
    header[4] = width;
    header[20] = DDPF_RGBA;
    header[22] = 32;
    header[23] = 0x000000FF;
    header[24] = 0x0000FF00;
    header[25] = 0x00FF0000;
    header[26] = 0xFF000000;
}

function rawFormat(
    channelFormat: ChannelFormat,
    bitsPerPixel: number,
    channelOrderInPixel: number[],
    channelStartInPixel: number[],
    channelLengthInPixel: number[],
): RawPixelFormat {
    return {
        compressed: false,
        valueType: PixelValueType.unorm,
        bitsPerPixel,
        channelCount: channelOrderInPixel.length,
        channelOrderInPixel,
        channelStartInPixel,
        channelLengthInPixel,
        channelFormat,
    };
}
