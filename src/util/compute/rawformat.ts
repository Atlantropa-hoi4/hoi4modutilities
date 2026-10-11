import { ChannelFormat, PixelValueType } from '../image/dds/pixelformat';
import { ComputeInput } from './protocol';

// A deliberately narrow fast path: other channel widths/value types retain Surface's semantics.
export function rawRgba8Input(input: ComputeInput): ComputeInput | undefined {
    const format = input.pixelFormat;
    if (!format || format.compressed || ![PixelValueType.uint, PixelValueType.unorm].includes(format.valueType)
        || ![24, 32].includes(format.bitsPerPixel)
        || ![ChannelFormat.rgb, ChannelFormat.rgba].includes(format.channelFormat)) {
        return undefined;
    }
    const channels = format.channelFormat === ChannelFormat.rgba ? 4 : 3;
    if (format.channelCount !== channels || format.channelOrderInPixel.length !== channels
        || new Set(format.channelOrderInPixel).size !== channels
        || !format.channelOrderInPixel.every(channel => Number.isInteger(channel) && channel >= 0 && channel < channels)) {
        return undefined;
    }
    const pixelStride = format.bitsPerPixel / 8;
    const offsets: number[] = [];
    for (let channel = 0; channel < channels; channel++) {
        const start = format.channelStartInPixel[channel];
        if (format.channelLengthInPixel[channel] !== 8 || !Number.isInteger(start) || start < 0 || start % 8 !== 0
            || start / 8 >= pixelStride) { return undefined; }
        offsets.push(start / 8);
    }
    // Surface's legacy compact reader ignores leading padding. Only dense layouts
    // starting at byte zero are interchangeable with the offset-based Rust kernel.
    if (!format.channelOrderInPixel.every((channel, index) => offsets[channel] === index)) { return undefined; }
    const alpha = channels === 4 ? offsets[3] : 255;
    const packedOffsets = (offsets[0] | offsets[1] << 8 | offsets[2] << 16 | alpha << 24) >>> 0;
    return { ...input, kind: 'rgba8', format: pixelStride, stride: packedOffsets };
}
