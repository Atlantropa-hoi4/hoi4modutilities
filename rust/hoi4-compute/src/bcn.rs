use crate::{
    pixel_bytes, result_length, validate_input_length, write_header, zeroed_bytes, ComputeError,
    RESULT_HEADER_BYTES,
};

#[derive(Clone, Copy)]
pub(crate) struct BcnLayout {
    width: usize,
    height: usize,
    blocks_per_row: usize,
    block_bytes: usize,
    input_bytes: usize,
    pixel_bytes: usize,
    format: u32,
}

impl BcnLayout {
    pub(crate) fn new(
        input_len: usize,
        width: u32,
        height: u32,
        format: u32,
    ) -> Result<Self, ComputeError> {
        validate_input_length(input_len)?;
        let pixel_bytes = pixel_bytes(width, height)?;
        let block_bytes = match format {
            1 => 8,
            2 | 3 => 16,
            _ => return Err(ComputeError::UnsupportedFormat),
        };
        let width = width as usize;
        let height = height as usize;
        let blocks_per_row = width
            .checked_add(3)
            .ok_or(ComputeError::SizeLimitExceeded)?
            / 4;
        let block_rows = height
            .checked_add(3)
            .ok_or(ComputeError::SizeLimitExceeded)?
            / 4;
        let input_bytes = blocks_per_row
            .checked_mul(block_rows)
            .and_then(|blocks| blocks.checked_mul(block_bytes))
            .ok_or(ComputeError::SizeLimitExceeded)?;
        if input_len < input_bytes {
            return Err(ComputeError::TruncatedInput);
        }
        Ok(Self {
            width,
            height,
            blocks_per_row,
            block_bytes,
            input_bytes,
            pixel_bytes,
            format,
        })
    }
}

/// Decode BC1 (1), BC2 (2), or BC3 (3) into the ABI v1 serialized RGBA result.
/// `premultiplied` applies the current JS byte-wrapping unpremultiplication.
pub fn decode_bcn(
    input: &[u8],
    width: u32,
    height: u32,
    format: u32,
    premultiplied: bool,
) -> Result<Box<[u8]>, ComputeError> {
    let layout = BcnLayout::new(input.len(), width, height, format)?;
    decode_with_layout(input, layout, premultiplied)
}

pub(crate) fn decode_with_layout(
    input: &[u8],
    layout: BcnLayout,
    premultiplied: bool,
) -> Result<Box<[u8]>, ComputeError> {
    let mut result = zeroed_bytes(result_length(layout.pixel_bytes, 0)?)?;
    write_header(&mut result, layout.pixel_bytes, 0);
    let pixels = &mut result[RESULT_HEADER_BYTES..];

    // Layout validation proves every full block and clipped destination fits.
    for (index, source) in input[..layout.input_bytes]
        .chunks_exact(layout.block_bytes)
        .enumerate()
    {
        let block = decode_block(source, layout.format);
        let x_start = (index % layout.blocks_per_row) * 4;
        let y_start = (index / layout.blocks_per_row) * 4;
        let columns = (layout.width - x_start).min(4);
        let rows = (layout.height - y_start).min(4);
        for y in 0..rows {
            let row_offset = ((y_start + y) * layout.width + x_start) * 4;
            for x in 0..columns {
                let source_offset = (y * 4 + x) * 4;
                let destination = &mut pixels[row_offset + x * 4..row_offset + x * 4 + 4];
                destination.copy_from_slice(&block[source_offset..source_offset + 4]);
                let alpha = destination[3];
                if premultiplied && alpha != 0 {
                    for channel in &mut destination[..3] {
                        // Preserve JS division order and Uint8Array ToUint8.
                        // All inputs are finite and the quotient is <= 65025.
                        let value = f64::from(*channel) / (f64::from(alpha) / 255.0);
                        *channel = (value.trunc() as u32 & 0xff) as u8;
                    }
                }
            }
        }
    }
    Ok(result.into_boxed_slice())
}

fn rgb565(value: u16) -> [u8; 4] {
    [
        (f64::from((value & 0xf800) >> 11) * 255.0 / 31.0).floor() as u8,
        (f64::from((value & 0x07e0) >> 5) * 255.0 / 63.0).floor() as u8,
        (f64::from(value & 0x001f) * 255.0 / 31.0).floor() as u8,
        255,
    ]
}

fn weighted_color(first: [u8; 4], w1: f64, second: [u8; 4], w2: f64) -> [u8; 4] {
    let mut result = [0; 4];
    for channel in 0..4 {
        // Integer weighted division is not equivalent to JS float64 + floor.
        result[channel] =
            (f64::from(first[channel]) * w1 + f64::from(second[channel]) * w2).floor() as u8;
    }
    result
}

fn decode_block(source: &[u8], format: u32) -> [u8; 64] {
    let color_offset = if format == 1 { 0 } else { 8 };
    let color0 = u16::from_le_bytes([source[color_offset], source[color_offset + 1]]);
    let color1 = u16::from_le_bytes([source[color_offset + 2], source[color_offset + 3]]);
    let mut colors = [rgb565(color0), rgb565(color1), [0; 4], [0; 4]];
    if color0 > color1 || format != 1 {
        colors[2] = weighted_color(colors[0], 2.0 / 3.0, colors[1], 1.0 / 3.0);
        colors[3] = weighted_color(colors[0], 1.0 / 3.0, colors[1], 2.0 / 3.0);
    } else {
        colors[2] = weighted_color(colors[0], 0.5, colors[1], 0.5);
    }

    let mut block = [0; 64];
    for y in 0..4 {
        let mut indices = source[color_offset + 4 + y];
        for x in 0..4 {
            let offset = (y * 4 + x) * 4;
            block[offset..offset + 4].copy_from_slice(&colors[(indices & 3) as usize]);
            indices >>= 2;
        }
    }

    if format == 2 {
        for pixel in 0..16 {
            let nibble = (source[pixel / 2] >> ((pixel % 2) * 4)) & 0xf;
            block[pixel * 4 + 3] = (f64::from(nibble) * 255.0 / 15.0) as u8;
        }
    } else if format == 3 {
        let alphas = alpha_palette(source[0], source[1]);
        let mut indices = 0_u64;
        for byte in 0..6 {
            indices |= u64::from(source[2 + byte]) << (byte * 8);
        }
        for pixel in 0..16 {
            block[pixel * 4 + 3] = alphas[(indices & 7) as usize];
            indices >>= 3;
        }
    }
    block
}

fn alpha_palette(first: u8, second: u8) -> [u8; 8] {
    let mut alphas = [first, second, 0, 0, 0, 0, 0, 0];
    let (steps, first_weight) = if first > second { (6, 6) } else { (4, 4) };
    for step in 0..steps {
        // The JS lower-endpoint branch also uses / 7, intentionally retained.
        let numerator =
            (first_weight - step) as f64 * f64::from(first) + (step + 1) as f64 * f64::from(second);
        alphas[step + 2] = (numerator / 7.0).floor() as u8;
    }
    if first <= second {
        alphas[7] = 255;
    }
    alphas
}
