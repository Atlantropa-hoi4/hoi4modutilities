use crate::{
    abi_version, bcn::BcnLayout, bgr::BgrLayout, decode_bcn, result_length, scan_bgr, zeroed_bytes,
    ComputeError, MAX_INPUT_BYTES, MAX_OUTPUT_BYTES, RESULT_HEADER_BYTES,
};

fn color_block(first: u16, second: u16, indices: [u8; 4]) -> [u8; 8] {
    let mut block = [0; 8];
    block[..2].copy_from_slice(&first.to_le_bytes());
    block[2..4].copy_from_slice(&second.to_le_bytes());
    block[4..].copy_from_slice(&indices);
    block
}

fn bc2_block(alpha: [u8; 8], first: u16, second: u16, indices: [u8; 4]) -> [u8; 16] {
    let mut block = [0; 16];
    block[..8].copy_from_slice(&alpha);
    block[8..].copy_from_slice(&color_block(first, second, indices));
    block
}

fn bc3_block(
    first_alpha: u8,
    second_alpha: u8,
    selectors: [u8; 16],
    first: u16,
    second: u16,
    indices: [u8; 4],
) -> [u8; 16] {
    let mut block = [0; 16];
    block[0] = first_alpha;
    block[1] = second_alpha;
    let mut alpha_bits = 0_u64;
    for (pixel, selector) in selectors.into_iter().enumerate() {
        alpha_bits |= u64::from(selector) << (pixel * 3);
    }
    block[2..8].copy_from_slice(&alpha_bits.to_le_bytes()[..6]);
    block[8..].copy_from_slice(&color_block(first, second, indices));
    block
}

fn header(result: &[u8]) -> [u32; 3] {
    assert!(result.len() >= RESULT_HEADER_BYTES);
    let fields = std::array::from_fn(|index| {
        u32::from_le_bytes(result[index * 4..index * 4 + 4].try_into().unwrap())
    });
    assert_eq!(fields[0] as usize, result.len());
    assert_eq!(
        result.len(),
        RESULT_HEADER_BYTES + fields[1] as usize + fields[2] as usize * 4
    );
    fields
}

fn rgba(result: &[u8]) -> Vec<[u8; 4]> {
    let fields = header(result);
    assert_eq!(fields[2], 0);
    let pixels = &result[RESULT_HEADER_BYTES..];
    assert_eq!(pixels.len() % 4, 0);
    pixels
        .chunks_exact(4)
        .map(|pixel| pixel.try_into().unwrap())
        .collect()
}

fn words(bytes: &[u8]) -> Vec<u32> {
    assert_eq!(bytes.len() % 4, 0);
    bytes
        .chunks_exact(4)
        .map(|word| u32::from_le_bytes(word.try_into().unwrap()))
        .collect()
}

fn bgr_input(rows: &[&[u32]], padding: usize) -> (Vec<u8>, u32) {
    let width = rows[0].len();
    let mut input = Vec::new();
    for row in rows {
        assert_eq!(row.len(), width);
        for color in *row {
            input.extend_from_slice(&color.to_le_bytes()[..3]);
        }
        input.extend(std::iter::repeat_n(0xa5, padding));
    }
    (input, (width * 3 + padding) as u32)
}

#[test]
fn abi_version_is_one() {
    assert_eq!(abi_version(), 1);
}

#[test]
fn bc1_transparent_palette_uses_half_and_zero() {
    let block = color_block(0, 0xffff, [0xe4; 4]);
    let result = decode_bcn(&block, 4, 4, 1, false).unwrap();
    assert_eq!(header(&result), [76, 64, 0]);
    let expected = [
        [0, 0, 0, 255],
        [255, 255, 255, 255],
        [127, 127, 127, 255],
        [0, 0, 0, 0],
    ];
    for row in rgba(&result).chunks_exact(4) {
        assert_eq!(row, expected);
    }
}

#[test]
fn bc1_equal_endpoints_still_enable_transparency() {
    let block = color_block(0xf800, 0xf800, [0xff; 4]);
    let result = decode_bcn(&block, 4, 4, 1, true).unwrap();
    assert!(rgba(&result).iter().all(|pixel| *pixel == [0, 0, 0, 0]));
}

#[test]
fn bc1_four_color_palette() {
    let block = color_block(0xf800, 0x07e0, [0xe4; 4]);
    let result = decode_bcn(&block, 4, 4, 1, false).unwrap();
    let expected = [
        [255, 0, 0, 255],
        [0, 255, 0, 255],
        [170, 85, 0, 255],
        [85, 170, 0, 255],
    ];
    for row in rgba(&result).chunks_exact(4) {
        assert_eq!(row, expected);
    }
}

#[test]
fn rgb565_scales_with_floor_instead_of_bit_replication() {
    let result = decode_bcn(&color_block(0x0821, 0, [0; 4]), 1, 1, 1, false).unwrap();
    assert_eq!(rgba(&result), [[8, 4, 8, 255]]);
    let result = decode_bcn(&color_block(0x1ce3, 0, [0; 4]), 1, 1, 1, false).unwrap();
    assert_eq!(rgba(&result), [[24, 157, 24, 255]]);
}

#[test]
fn bc2_explicit_alpha_and_float_interpolation_with_reversed_endpoints() {
    let block = bc2_block(
        [0x10, 0x32, 0x54, 0x76, 0x98, 0xba, 0xdc, 0xfe],
        0x0800,
        0x4000,
        [0xe4; 4],
    );
    let result = decode_bcn(&block, 4, 4, 2, false).unwrap();
    for (index, pixel) in rgba(&result).iter().enumerate() {
        // JS float64 arithmetic floors these interpolations to 26 and 45;
        // integer weighted division would produce 27 and 46.
        assert_eq!(*pixel, [[8, 65, 26, 45][index % 4], 0, 0, index as u8 * 17]);
    }
}

fn assert_bc3_alphas(first: u8, second: u8, expected: [u8; 8]) {
    let selectors = std::array::from_fn(|pixel| (pixel % 8) as u8);
    let block = bc3_block(first, second, selectors, 0, 0xffff, [0xff; 4]);
    let result = decode_bcn(&block, 4, 4, 3, false).unwrap();
    for (index, pixel) in rgba(&result).iter().enumerate() {
        // BC3 must use the fourth RGB color even when color0 <= color1.
        assert_eq!(*pixel, [170, 170, 170, expected[index % 8]]);
    }
}

#[test]
fn bc3_greater_alpha_endpoint_branch() {
    assert_bc3_alphas(255, 0, [255, 0, 218, 182, 145, 109, 72, 36]);
}

#[test]
fn bc3_lower_alpha_endpoint_branch_preserves_js_denominator() {
    assert_bc3_alphas(10, 200, [10, 200, 34, 61, 88, 115, 0, 255]);
}

#[test]
fn bc3_equal_alpha_endpoint_branch() {
    assert_bc3_alphas(70, 70, [70, 70, 50, 50, 50, 50, 0, 255]);
}

#[test]
fn partial_blocks_clip_both_axes_and_keep_source_block_order() {
    let mut input = Vec::new();
    for color in [0xf800, 0x07e0, 0x001f, 0xffff] {
        input.extend_from_slice(&color_block(color, 0, [0; 4]));
    }
    let result = decode_bcn(&input, 5, 5, 1, false).unwrap();
    assert_eq!(header(&result), [112, 100, 0]);
    for y in 0..5 {
        for x in 0..5 {
            let expected = match (x == 4, y == 4) {
                (false, false) => [255, 0, 0, 255],
                (true, false) => [0, 255, 0, 255],
                (false, true) => [0, 0, 255, 255],
                (true, true) => [255, 255, 255, 255],
            };
            assert_eq!(rgba(&result)[y * 5 + x], expected);
        }
    }
}

#[test]
fn partial_block_uses_full_four_pixel_source_row_pitch() {
    let block = color_block(0xf800, 0x07e0, [0xe4, 0x1b, 0, 0]);
    let result = decode_bcn(&block, 3, 2, 1, false).unwrap();
    assert_eq!(
        rgba(&result),
        [
            [255, 0, 0, 255],
            [0, 255, 0, 255],
            [170, 85, 0, 255],
            [85, 170, 0, 255],
            [170, 85, 0, 255],
            [0, 255, 0, 255],
        ]
    );
}

#[test]
fn premultiplied_bc2_wraps_truncates_and_preserves_zero_alpha_rgb() {
    let block = bc2_block(
        [0x01, 0xf2, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff],
        0x8021,
        0,
        [0; 4],
    );
    let result = decode_bcn(&block, 4, 1, 2, true).unwrap();
    assert_eq!(
        rgba(&result),
        [
            [173, 60, 120, 17],
            [131, 4, 8, 0],
            [214, 30, 60, 34],
            [131, 4, 8, 255],
        ]
    );
    let white = bc2_block([0x11; 8], 0xffff, 0, [0; 4]);
    let result = decode_bcn(&white, 1, 1, 2, true).unwrap();
    assert_eq!(rgba(&result), [[241, 241, 241, 17]]);
    let result = decode_bcn(&white, 1, 1, 2, false).unwrap();
    assert_eq!(rgba(&result), [[255, 255, 255, 17]]);
}

#[test]
fn premultiplied_bc3_preserves_js_division_order() {
    let block = bc3_block(33, 0, [0; 16], 0x0160, 0, [0; 4]);
    let result = decode_bcn(&block, 1, 1, 3, true).unwrap();
    // 44 / (33 / 255) is 339.99999999999994 in JS; 44 * 255 / 33 is 340.
    assert_eq!(rgba(&result), [[0, 83, 0, 33]]);
}

#[test]
fn bcn_rejects_invalid_dimensions_formats_and_truncated_blocks() {
    for (width, height) in [(0, 1), (1, 0), (0, 0)] {
        assert_eq!(
            decode_bcn(&[0; 16], width, height, 1, false),
            Err(ComputeError::InvalidParameters)
        );
    }
    for format in [0, 4, u32::MAX] {
        assert_eq!(
            decode_bcn(&[0; 16], 1, 1, format, false),
            Err(ComputeError::UnsupportedFormat)
        );
    }
    for (format, required) in [(1, 8), (2, 16), (3, 16)] {
        assert_eq!(
            decode_bcn(&[0; 16][..required - 1], 1, 1, format, false),
            Err(ComputeError::TruncatedInput)
        );
    }
    assert_eq!(
        decode_bcn(&[0; 24], 5, 5, 1, false),
        Err(ComputeError::TruncatedInput)
    );
    assert_eq!(
        decode_bcn(&[], 1, 1, 1, false),
        Err(ComputeError::TruncatedInput)
    );
}

#[test]
fn bcn_ignores_extra_input_bytes() {
    let block = color_block(0xf800, 0, [0; 4]);
    let mut input = block.to_vec();
    input.extend_from_slice(&[0xff; 13]);
    assert_eq!(
        decode_bcn(&input, 1, 1, 1, false),
        decode_bcn(&block, 1, 1, 1, false)
    );
}

#[test]
fn bgr_flips_rows_skips_padding_and_preserves_unique_source_order() {
    let (input, stride) = bgr_input(&[&[0x112233, 0], &[0xffffff, 0x112233]], 2);
    let result = scan_bgr(&input, 2, 2, stride).unwrap();
    assert_eq!(
        &result[..RESULT_HEADER_BYTES],
        &[40, 0, 0, 0, 16, 0, 0, 0, 3, 0, 0, 0]
    );
    assert_eq!(header(&result), [40, 16, 3]);
    assert_eq!(words(&result[12..28]), [0xffffff, 0x112233, 0x112233, 0]);
    assert_eq!(words(&result[28..]), [0x112233, 0, 0xffffff]);
}

#[test]
fn bgr_single_pixel_and_extra_input_bytes() {
    let result = scan_bgr(&[0x56, 0x34, 0x12, 0xff, 0xee], 1, 1, 3).unwrap();
    assert_eq!(header(&result), [20, 4, 1]);
    assert_eq!(&result[12..16], &[0x56, 0x34, 0x12, 0]);
    assert_eq!(words(&result[16..]), [0x123456]);
}

#[test]
fn bgr_seen_bitset_handles_zero_byte_boundaries_and_highest_color() {
    let colors = [0, 7, 8, 255, 256, 0xfffff8, 0xffffff, 7, 0, 0xffffff];
    let (input, stride) = bgr_input(&[&colors], 0);
    let result = scan_bgr(&input, colors.len() as u32, 1, stride).unwrap();
    let fields = header(&result);
    assert_eq!(fields[2], 7);
    assert_eq!(words(&result[12..52]), colors);
    assert_eq!(words(&result[52..]), colors[..7]);
}

#[test]
fn bgr_unique_tail_grows_without_losing_pixels_or_order() {
    let colors: Vec<u32> = (0..1500).rev().collect();
    let (input, stride) = bgr_input(&[&colors], 1);
    let result = scan_bgr(&input, 1500, 1, stride).unwrap();
    assert_eq!(header(&result), [12012, 6000, 1500]);
    assert_eq!(words(&result[12..6012]), colors);
    assert_eq!(words(&result[6012..]), colors);
}

#[test]
fn bgr_rejects_zero_dimensions_invalid_stride_and_truncation() {
    for (width, height) in [(0, 1), (1, 0), (0, 0)] {
        assert_eq!(
            scan_bgr(&[0; 16], width, height, 8),
            Err(ComputeError::InvalidParameters)
        );
    }
    for stride in [0, 1, 5] {
        assert_eq!(
            scan_bgr(&[0; 16], 2, 2, stride),
            Err(ComputeError::InvalidParameters)
        );
    }
    assert_eq!(
        scan_bgr(&[0; 14], 2, 2, 8),
        Err(ComputeError::TruncatedInput)
    );
    assert_eq!(scan_bgr(&[], 1, 1, 3), Err(ComputeError::TruncatedInput));
}

#[test]
fn size_checks_reject_oversized_input_before_allocation() {
    assert!(matches!(
        BcnLayout::new(MAX_INPUT_BYTES + 1, 1, 1, 1),
        Err(ComputeError::SizeLimitExceeded)
    ));
    assert!(matches!(
        BgrLayout::new(MAX_INPUT_BYTES + 1, 1, 1, 3),
        Err(ComputeError::SizeLimitExceeded)
    ));
    // Verify the largest unpadded BGR row without allocating its input or output.
    let width = (MAX_INPUT_BYTES / 3) as u32;
    assert!(BgrLayout::new(MAX_INPUT_BYTES, width, 1, width * 3).is_ok());
}

#[test]
fn size_checks_include_header_and_unique_colors_and_detect_overflow() {
    assert_eq!(
        result_length(MAX_OUTPUT_BYTES - 12, 0),
        Ok(MAX_OUTPUT_BYTES)
    );
    assert_eq!(
        result_length(MAX_OUTPUT_BYTES - 12, 1),
        Err(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(
        result_length(usize::MAX, 0),
        Err(ComputeError::SizeLimitExceeded)
    );
    assert_eq!(
        result_length(4, usize::MAX),
        Err(ComputeError::SizeLimitExceeded)
    );
    for (width, height) in [(8192, 8192), (u32::MAX, 1), (u32::MAX, u32::MAX)] {
        assert_eq!(
            decode_bcn(&[], width, height, 1, false),
            Err(ComputeError::SizeLimitExceeded)
        );
        assert_eq!(
            scan_bgr(&[], width, height, u32::MAX),
            Err(ComputeError::SizeLimitExceeded)
        );
    }
    assert!(BcnLayout::new(MAX_INPUT_BYTES, 3, 22_369_620, 1).is_ok());
}

#[test]
fn zeroed_byte_reservation_initializes_every_byte_and_checks_limit() {
    assert_eq!(zeroed_bytes(37).unwrap(), [0; 37]);
    assert_eq!(
        zeroed_bytes(MAX_OUTPUT_BYTES + 1),
        Err(ComputeError::SizeLimitExceeded)
    );
}
