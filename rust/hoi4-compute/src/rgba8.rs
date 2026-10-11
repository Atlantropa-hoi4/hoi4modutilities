use crate::{
    pixel_bytes, result_length, validate_input_length, write_header, zeroed_bytes, ComputeError,
    RESULT_HEADER_BYTES,
};

#[derive(Clone, Copy)]
pub(crate) struct Rgba8Layout {
    bytes_per_pixel: usize,
    channel_offsets: [u8; 4],
    input_bytes: usize,
    pixel_bytes: usize,
}

impl Rgba8Layout {
    pub(crate) fn new(
        input_len: usize,
        width: u32,
        height: u32,
        bytes_per_pixel: u32,
        channel_offsets: u32,
    ) -> Result<Self, ComputeError> {
        validate_input_length(input_len)?;
        let pixel_bytes = pixel_bytes(width, height)?;
        if !matches!(bytes_per_pixel, 3 | 4) {
            return Err(ComputeError::UnsupportedFormat);
        }
        let channel_offsets = channel_offsets.to_le_bytes();
        if channel_offsets[..3]
            .iter()
            .any(|&offset| u32::from(offset) >= bytes_per_pixel)
            || (channel_offsets[3] != 255 && u32::from(channel_offsets[3]) >= bytes_per_pixel)
        {
            return Err(ComputeError::InvalidParameters);
        }
        let bytes_per_pixel = bytes_per_pixel as usize;
        let input_bytes = (pixel_bytes / 4)
            .checked_mul(bytes_per_pixel)
            .ok_or(ComputeError::SizeLimitExceeded)?;
        if input_len < input_bytes {
            return Err(ComputeError::TruncatedInput);
        }
        Ok(Self {
            bytes_per_pixel,
            channel_offsets,
            input_bytes,
            pixel_bytes,
        })
    }
}

/// Decode packed 24/32-bit uint/unorm pixels into the ABI v1 RGBA result.
/// `channel_offsets` packs R, G, B, A source byte offsets in little-endian order;
/// alpha offset 255 supplies constant 255. Rows retain their source order.
pub fn decode_rgba8(
    input: &[u8],
    width: u32,
    height: u32,
    bytes_per_pixel: u32,
    channel_offsets: u32,
) -> Result<Box<[u8]>, ComputeError> {
    let layout = Rgba8Layout::new(input.len(), width, height, bytes_per_pixel, channel_offsets)?;
    decode_with_layout(input, layout)
}

pub(crate) fn decode_with_layout(
    input: &[u8],
    layout: Rgba8Layout,
) -> Result<Box<[u8]>, ComputeError> {
    let mut result = zeroed_bytes(result_length(layout.pixel_bytes, 0)?)?;
    write_header(&mut result, layout.pixel_bytes, 0);
    let offsets = layout.channel_offsets;
    let pixels = &mut result[RESULT_HEADER_BYTES..];

    // Validated packed extents exclude trailing bytes and bound each offset.
    for (source, destination) in input[..layout.input_bytes]
        .chunks_exact(layout.bytes_per_pixel)
        .zip(pixels.chunks_exact_mut(4))
    {
        for channel in 0..3 {
            destination[channel] = normalized_byte(source[offsets[channel] as usize]);
        }
        destination[3] = if offsets[3] == 255 {
            255
        } else {
            normalized_byte(source[offsets[3] as usize])
        };
    }
    Ok(result.into_boxed_slice())
}

fn normalized_byte(value: u8) -> u8 {
    // Preserve Surface's uint/unorm float64 normalization and Uint8Array truncation.
    ((f64::from(value) / 255.0) * 255.0) as u8
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{MAX_INPUT_BYTES, MAX_OUTPUT_BYTES};

    fn offsets(channels: [u8; 4]) -> u32 {
        u32::from_le_bytes(channels)
    }

    fn pixels(result: &[u8]) -> &[u8] {
        let header: [u32; 3] = std::array::from_fn(|index| {
            u32::from_le_bytes(result[index * 4..index * 4 + 4].try_into().unwrap())
        });
        assert_eq!(header[0] as usize, result.len());
        assert_eq!(header[1] as usize, result.len() - RESULT_HEADER_BYTES);
        assert_eq!(header[2], 0);
        &result[RESULT_HEADER_BYTES..]
    }

    #[test]
    fn every_byte_matches_surface_uint_unorm_truncation() {
        let mut input = Vec::new();
        let mut expected = Vec::new();
        for value in 0..=255_u8 {
            input.extend_from_slice(&[value; 4]);
            // Exhaustive Node uint/unorm + Uint8Array results retain every byte.
            expected.extend_from_slice(&[value; 4]);
        }
        let result = decode_rgba8(&input, 16, 16, 4, offsets([0, 1, 2, 3])).unwrap();
        assert_eq!(pixels(&result), expected);

        let input: Vec<u8> = input
            .chunks_exact(4)
            .flat_map(|pixel| pixel[..3].iter().copied())
            .collect();
        for pixel in expected.chunks_exact_mut(4) {
            pixel[3] = 255;
        }
        let result = decode_rgba8(&input, 16, 16, 3, offsets([0, 1, 2, 255])).unwrap();
        assert_eq!(pixels(&result), expected);
    }

    #[test]
    fn rgb_and_bgr_channel_permutations() {
        for (input, channel_offsets) in [
            ([11, 22, 33, 44, 55, 66], [0, 1, 2, 255]),
            ([33, 22, 11, 66, 55, 44], [2, 1, 0, 255]),
        ] {
            let result = decode_rgba8(&input, 2, 1, 3, offsets(channel_offsets)).unwrap();
            assert_eq!(pixels(&result), [11, 22, 33, 255, 44, 55, 66, 255]);
        }
    }

    #[test]
    fn rgba_argb_bgra_and_abgr_channel_permutations() {
        for (input, channel_offsets) in [
            ([11, 22, 33, 44, 55, 66, 77, 88], [0, 1, 2, 3]),
            ([44, 11, 22, 33, 88, 55, 66, 77], [1, 2, 3, 0]),
            ([33, 22, 11, 44, 77, 66, 55, 88], [2, 1, 0, 3]),
            ([44, 33, 22, 11, 88, 77, 66, 55], [3, 2, 1, 0]),
        ] {
            let result = decode_rgba8(&input, 2, 1, 4, offsets(channel_offsets)).unwrap();
            assert_eq!(pixels(&result), [11, 22, 33, 44, 55, 66, 77, 88]);
        }
    }

    #[test]
    fn opaque_alpha_in_24_and_32_bit_rgb() {
        let result = decode_rgba8(&[11, 22, 33], 1, 1, 3, offsets([0, 1, 2, 255])).unwrap();
        assert_eq!(pixels(&result), [11, 22, 33, 255]);
        for padding in [0, 77, 255] {
            let result =
                decode_rgba8(&[33, 22, 11, padding], 1, 1, 4, offsets([2, 1, 0, 255])).unwrap();
            assert_eq!(pixels(&result), [11, 22, 33, 255]);
        }
    }

    #[test]
    fn packed_rows_keep_order_and_rgb_is_not_premultiplied() {
        let input = [
            20, 40, 60, 0, 30, 50, 70, 128, 80, 100, 120, 255, 90, 110, 130, 64,
        ];
        let result = decode_rgba8(&input, 2, 2, 4, offsets([0, 1, 2, 3])).unwrap();
        assert_eq!(pixels(&result), input);
        let input = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
        let result = decode_rgba8(&input, 2, 2, 3, offsets([0, 1, 2, 255])).unwrap();
        assert_eq!(
            pixels(&result),
            [1, 2, 3, 255, 4, 5, 6, 255, 7, 8, 9, 255, 10, 11, 12, 255]
        );
    }

    #[test]
    fn repeated_in_range_offsets_are_valid() {
        let result = decode_rgba8(&[10, 20, 30], 1, 1, 3, offsets([2, 2, 0, 1])).unwrap();
        assert_eq!(pixels(&result), [30, 30, 10, 20]);
    }

    #[test]
    fn extra_bytes_are_ignored_but_truncated_pixels_are_rejected() {
        for bytes_per_pixel in [3, 4] {
            let channel_offsets = offsets([0, 1, 2, 255]);
            let input: Vec<u8> = (0..2 * bytes_per_pixel).map(|value| value as u8).collect();
            let expected = decode_rgba8(&input, 1, 2, bytes_per_pixel, channel_offsets).unwrap();
            for extra in [vec![201], vec![202; 9]] {
                let mut extended = input.clone();
                extended.extend_from_slice(&extra);
                assert_eq!(
                    decode_rgba8(&extended, 1, 2, bytes_per_pixel, channel_offsets).unwrap(),
                    expected
                );
            }
            for length in 0..input.len() {
                assert_eq!(
                    decode_rgba8(&input[..length], 1, 2, bytes_per_pixel, channel_offsets),
                    Err(ComputeError::TruncatedInput)
                );
            }
        }
    }

    #[test]
    fn zero_dimensions_and_unsupported_pixel_strides_are_rejected() {
        let channel_offsets = offsets([0, 1, 2, 255]);
        for (width, height) in [(0, 0), (0, 1), (1, 0)] {
            assert_eq!(
                decode_rgba8(&[], width, height, 3, channel_offsets),
                Err(ComputeError::InvalidParameters)
            );
        }
        for bytes_per_pixel in [0, 1, 2, 5, 8, u32::MAX] {
            assert_eq!(
                decode_rgba8(&[], 1, 1, bytes_per_pixel, channel_offsets),
                Err(ComputeError::UnsupportedFormat)
            );
        }
    }

    #[test]
    fn out_of_range_offsets_and_rgb_opaque_sentinels_are_rejected() {
        for bytes_per_pixel in [3, 4] {
            for channel in 0..4 {
                for offset in [bytes_per_pixel as u8, 254, 255] {
                    if channel == 3 && offset == 255 {
                        continue;
                    }
                    let mut channel_offsets = [0, 1, 2, 255];
                    channel_offsets[channel] = offset;
                    assert_eq!(
                        decode_rgba8(&[0; 4], 1, 1, bytes_per_pixel, offsets(channel_offsets)),
                        Err(ComputeError::InvalidParameters)
                    );
                }
            }
        }
    }

    #[test]
    fn input_limit_includes_trailing_bytes_without_large_allocations() {
        let channel_offsets = offsets([0, 1, 2, 255]);
        for bytes_per_pixel in [3, 4] {
            let width = (MAX_INPUT_BYTES / bytes_per_pixel as usize) as u32;
            assert!(
                Rgba8Layout::new(MAX_INPUT_BYTES, width, 1, bytes_per_pixel, channel_offsets)
                    .is_ok()
            );
            assert!(matches!(
                Rgba8Layout::new(MAX_INPUT_BYTES + 1, 1, 1, bytes_per_pixel, channel_offsets),
                Err(ComputeError::SizeLimitExceeded)
            ));
        }
    }

    #[test]
    fn result_limit_includes_header_and_dimension_overflow_is_rejected() {
        let channel_offsets = offsets([0, 1, 2, 255]);
        let max_pixels = ((MAX_OUTPUT_BYTES - RESULT_HEADER_BYTES) / 4) as u32;
        assert!(matches!(
            Rgba8Layout::new(MAX_INPUT_BYTES, max_pixels, 1, 3, channel_offsets),
            Err(ComputeError::TruncatedInput)
        ));
        for (width, height) in [
            (max_pixels + 1, 1),
            (1, max_pixels + 1),
            (u32::MAX, 1),
            (1, u32::MAX),
            (u32::MAX, u32::MAX),
        ] {
            assert_eq!(
                decode_rgba8(&[], width, height, 3, channel_offsets),
                Err(ComputeError::SizeLimitExceeded)
            );
        }
    }
}
