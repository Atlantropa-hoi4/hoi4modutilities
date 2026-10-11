use crate::{
    pixel_bytes, result_length, validate_input_length, write_header, zeroed_bytes, ComputeError,
    RESULT_HEADER_BYTES,
};

const COLOR_COUNT: usize = 1 << 24;
const SEEN_BYTES: usize = COLOR_COUNT / 8;

#[derive(Clone, Copy)]
pub(crate) struct BgrLayout {
    width: usize,
    height: usize,
    stride: usize,
    pixel_bytes: usize,
    max_result_bytes: usize,
}

impl BgrLayout {
    pub(crate) fn new(
        input_len: usize,
        width: u32,
        height: u32,
        stride: u32,
    ) -> Result<Self, ComputeError> {
        validate_input_length(input_len)?;
        let pixel_bytes = pixel_bytes(width, height)?;
        let width = width as usize;
        let height = height as usize;
        let stride = stride as usize;
        let row_bytes = width
            .checked_mul(3)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        if stride == 0 || row_bytes > stride {
            return Err(ComputeError::InvalidParameters);
        }
        let input_bytes = stride
            .checked_mul(height)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        if input_len < input_bytes {
            return Err(ComputeError::TruncatedInput);
        }
        // This upper bound fits under 256 MiB for every <= 128 MiB BGR input.
        let max_result_bytes = result_length(pixel_bytes, (pixel_bytes / 4).min(COLOR_COUNT))?;
        Ok(Self {
            width,
            height,
            stride,
            pixel_bytes,
            max_result_bytes,
        })
    }
}

/// Scan padded BGR rows into the ABI v1 serialized result. Pixels are reversed
/// by row; packed 0x00RRGGBB unique colors retain original source scan order.
pub fn scan_bgr(
    input: &[u8],
    width: u32,
    height: u32,
    stride: u32,
) -> Result<Box<[u8]>, ComputeError> {
    let layout = BgrLayout::new(input.len(), width, height, stride)?;
    scan_with_layout(input, layout)
}

pub(crate) fn scan_with_layout(input: &[u8], layout: BgrLayout) -> Result<Box<[u8]>, ComputeError> {
    let base_bytes = result_length(layout.pixel_bytes, 0)?;
    let mut result = zeroed_bytes(base_bytes)?;
    let mut seen = zeroed_bytes(SEEN_BYTES)?;
    let mut unique_count = 0;

    // Validated row extents and pixel byte length bound all loop arithmetic.
    for source_y in 0..layout.height {
        let source_row = source_y * layout.stride;
        let output_row = RESULT_HEADER_BYTES + (layout.height - 1 - source_y) * layout.width * 4;
        for x in 0..layout.width {
            let source = source_row + x * 3;
            let color = (u32::from(input[source + 2]) << 16)
                | (u32::from(input[source + 1]) << 8)
                | u32::from(input[source]);
            let bytes = color.to_le_bytes();
            let destination = output_row + x * 4;
            result[destination..destination + 4].copy_from_slice(&bytes);

            let seen_index = color as usize >> 3;
            let mask = 1_u8 << (color & 7);
            if seen[seen_index] & mask == 0 {
                append_unique(&mut result, bytes, base_bytes, layout.max_result_bytes)?;
                seen[seen_index] |= mask;
                unique_count += 1;
            }
        }
    }
    write_header(&mut result, layout.pixel_bytes, unique_count);
    Ok(result.into_boxed_slice())
}

fn append_unique(
    result: &mut Vec<u8>,
    color: [u8; 4],
    base_bytes: usize,
    max_result_bytes: usize,
) -> Result<(), ComputeError> {
    let new_length = result
        .len()
        .checked_add(4)
        .filter(|&length| length <= max_result_bytes)
        .ok_or(ComputeError::SizeLimitExceeded)?;
    if new_length > result.capacity() {
        // Double only the unique-color tail, not the much larger pixel buffer.
        let tail_capacity = result.capacity() - base_bytes;
        let new_tail = tail_capacity
            .checked_mul(2)
            .ok_or(ComputeError::SizeLimitExceeded)?
            .max(4096);
        let capacity = base_bytes
            .checked_add(new_tail)
            .ok_or(ComputeError::SizeLimitExceeded)?
            .min(max_result_bytes)
            .max(new_length);
        result
            .try_reserve_exact(capacity - result.len())
            .map_err(|_| ComputeError::AllocationFailed)?;
    }
    result.extend_from_slice(&color);
    Ok(())
}
