//! Safe pixel computation and a trusted, wasm32-only allocated-buffer ABI.
//! See the crate README for ownership, layout, and JS compatibility details.

#![deny(unsafe_op_in_unsafe_fn)]

mod bcn;
mod bgr;
mod edges;
mod rgba8;
mod script_index;

pub use bcn::decode_bcn;
pub use bgr::scan_bgr;
pub use edges::scan_edges;
pub use rgba8::decode_rgba8;
pub use script_index::extract_script_index;

pub const MAX_INPUT_BYTES: usize = 128 * 1024 * 1024;
pub const MAX_OUTPUT_BYTES: usize = 256 * 1024 * 1024;
pub const RESULT_HEADER_BYTES: usize = 12;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputeError {
    InvalidParameters,
    UnsupportedFormat,
    TruncatedInput,
    SizeLimitExceeded,
    AllocationFailed,
}

/// Version of the serialized-result and wasm32 pointer ABI.
#[no_mangle]
pub extern "C" fn abi_version() -> u32 {
    1
}

fn validate_input_length(input_len: usize) -> Result<(), ComputeError> {
    if input_len > MAX_INPUT_BYTES {
        Err(ComputeError::SizeLimitExceeded)
    } else {
        Ok(())
    }
}

fn pixel_bytes(width: u32, height: u32) -> Result<usize, ComputeError> {
    if width == 0 || height == 0 {
        return Err(ComputeError::InvalidParameters);
    }
    let bytes = (width as usize)
        .checked_mul(height as usize)
        .and_then(|count| count.checked_mul(4))
        .ok_or(ComputeError::SizeLimitExceeded)?;
    result_length(bytes, 0)?;
    Ok(bytes)
}

fn result_length(pixel_bytes: usize, unique_count: usize) -> Result<usize, ComputeError> {
    let length = unique_count
        .checked_mul(4)
        .and_then(|bytes| bytes.checked_add(pixel_bytes))
        .and_then(|bytes| bytes.checked_add(RESULT_HEADER_BYTES))
        .filter(|&bytes| bytes <= MAX_OUTPUT_BYTES)
        .ok_or(ComputeError::SizeLimitExceeded)?;
    Ok(length)
}

fn zeroed_bytes(length: usize) -> Result<Vec<u8>, ComputeError> {
    if length > MAX_OUTPUT_BYTES {
        return Err(ComputeError::SizeLimitExceeded);
    }
    let mut bytes = Vec::new();
    bytes
        .try_reserve_exact(length)
        .map_err(|_| ComputeError::AllocationFailed)?;
    bytes.resize(length, 0);
    Ok(bytes)
}

fn write_header(result: &mut [u8], pixel_bytes: usize, unique_count: usize) {
    // All callers have already bounded the complete result to 256 MiB.
    let total = result.len() as u32;
    result[0..4].copy_from_slice(&total.to_le_bytes());
    result[4..8].copy_from_slice(&(pixel_bytes as u32).to_le_bytes());
    result[8..12].copy_from_slice(&(unique_count as u32).to_le_bytes());
}

#[cfg(target_arch = "wasm32")]
pub use abi::{
    allocate, deallocate, process_bcn, process_bgr, process_edges, process_rgba8,
    process_script_index,
};

#[cfg(target_arch = "wasm32")]
mod abi {
    use super::*;

    /// Allocate an exactly sized, zeroed input box; return zero on failure.
    #[no_mangle]
    pub extern "C" fn allocate(length: u32) -> u32 {
        if length == 0 || length as usize > MAX_INPUT_BYTES {
            return 0;
        }
        match zeroed_bytes(length as usize) {
            Ok(bytes) => into_pointer(bytes.into_boxed_slice()),
            Err(_) => 0,
        }
    }

    /// Free an input or result box. A null pointer is a no-op.
    ///
    /// # Safety
    /// `pointer` must identify a live box allocated by this module, and
    /// `length` must be its exact original length. Free it once only, with
    /// no live users of its contents. Range checks do not verify ownership.
    #[no_mangle]
    pub unsafe extern "C" fn deallocate(pointer: u32, length: u32) {
        if length as usize > MAX_OUTPUT_BYTES || !valid_range(pointer, length) {
            return;
        }
        let slice = std::ptr::slice_from_raw_parts_mut(pointer as *mut u8, length as usize);
        // SAFETY: The trusted caller supplies the original pointer and length.
        drop(unsafe { Box::from_raw(slice) });
    }

    /// Decode BC1/BC2/BC3 data into a boxed serialized result, or return zero.
    ///
    /// # Safety
    /// The input must be a live buffer from `allocate` in this module,
    /// containing at least `input_len` bytes. Keep it allocated and unmodified
    /// throughout the call. The returned box is independently owned.
    #[no_mangle]
    pub unsafe extern "C" fn process_bcn(
        input_ptr: u32,
        input_len: u32,
        width: u32,
        height: u32,
        format: u32,
        premult: u32,
    ) -> u32 {
        if premult > 1 {
            return 0;
        }
        let Ok(layout) = bcn::BcnLayout::new(input_len as usize, width, height, format) else {
            return 0;
        };
        // SAFETY: The caller follows the trusted allocated-buffer contract.
        let Some(input) = (unsafe { input_slice(input_ptr, input_len) }) else {
            return 0;
        };
        match bcn::decode_with_layout(input, layout, premult != 0) {
            Ok(result) => into_pointer(result),
            Err(_) => 0,
        }
    }

    /// Scan BGR rows into a boxed serialized result, or return zero.
    ///
    /// # Safety
    /// The input must be a live buffer from `allocate` in this module,
    /// containing at least `input_len` bytes. Keep it allocated and unmodified
    /// throughout the call. The returned box is independently owned.
    #[no_mangle]
    pub unsafe extern "C" fn process_bgr(
        input_ptr: u32,
        input_len: u32,
        width: u32,
        height: u32,
        stride: u32,
    ) -> u32 {
        let Ok(layout) = bgr::BgrLayout::new(input_len as usize, width, height, stride) else {
            return 0;
        };
        // SAFETY: The caller follows the trusted allocated-buffer contract.
        let Some(input) = (unsafe { input_slice(input_ptr, input_len) }) else {
            return 0;
        };
        match bgr::scan_with_layout(input, layout) {
            Ok(result) => into_pointer(result),
            Err(_) => 0,
        }
    }

    /// Scan packed province colors into boundary paths and validation records,
    /// returning an independently owned serialized result, or zero on error.
    ///
    /// # Safety
    /// The input must be a live buffer from `allocate` in this module,
    /// containing at least `input_len` bytes. Keep it allocated and unmodified
    /// throughout the call. The returned box is independently owned.
    #[no_mangle]
    pub unsafe extern "C" fn process_edges(
        input_ptr: u32,
        input_len: u32,
        width: u32,
        height: u32,
    ) -> u32 {
        let Ok(layout) = edges::EdgesLayout::new(input_len as usize, width, height) else {
            return 0;
        };
        // SAFETY: The caller follows the trusted allocated-buffer contract.
        let Some(input) = (unsafe { input_slice(input_ptr, input_len) }) else {
            return 0;
        };
        match edges::scan_with_layout(input, layout) {
            Ok(result) => into_pointer(result),
            Err(_) => 0,
        }
    }

    /// Decode packed raw DDS pixels, returning zero on error.
    ///
    /// # Safety
    /// Input must be a live `allocate` buffer of at least `input_len` bytes,
    /// kept allocated and unmodified throughout the call.
    #[no_mangle]
    pub unsafe extern "C" fn process_rgba8(
        input_ptr: u32,
        input_len: u32,
        width: u32,
        height: u32,
        bytes_per_pixel: u32,
        channel_offsets: u32,
    ) -> u32 {
        let Ok(layout) = rgba8::Rgba8Layout::new(
            input_len as usize,
            width,
            height,
            bytes_per_pixel,
            channel_offsets,
        ) else {
            return 0;
        };
        // SAFETY: The caller follows the trusted allocated-buffer contract.
        let Some(input) = (unsafe { input_slice(input_ptr, input_len) }) else {
            return 0;
        };
        match rgba8::decode_with_layout(input, layout) {
            Ok(result) => into_pointer(result),
            Err(_) => 0,
        }
    }

    /// Extract a complete focus (mode 0) or GFX (mode 1) index, or reject with zero.
    ///
    /// # Safety
    /// Input follows the same live allocated-buffer contract as the pixel kernels.
    #[no_mangle]
    pub unsafe extern "C" fn process_script_index(
        input_ptr: u32,
        input_len: u32,
        mode: u32,
    ) -> u32 {
        // SAFETY: The caller follows the trusted allocated-buffer contract.
        let Some(input) = (unsafe { input_slice(input_ptr, input_len) }) else {
            return 0;
        };
        match script_index::extract_script_index(input, mode) {
            Ok(result) => into_pointer(result),
            Err(_) => 0,
        }
    }

    fn into_pointer(result: Box<[u8]>) -> u32 {
        // Only compiled for wasm32; there is no native pointer truncation.
        Box::into_raw(result) as *mut u8 as u32
    }

    fn valid_range(pointer: u32, length: u32) -> bool {
        if pointer == 0 || length == 0 {
            return false;
        }
        let Some(end) = (pointer as usize).checked_add(length as usize) else {
            return false;
        };
        // Use u64 so a full 4 GiB linear memory does not overflow usize.
        let memory_bytes = (std::arch::wasm32::memory_size(0) as u64) * 65_536;
        end as u64 <= memory_bytes
    }

    unsafe fn input_slice<'a>(pointer: u32, length: u32) -> Option<&'a [u8]> {
        if length as usize > MAX_INPUT_BYTES || !valid_range(pointer, length) {
            return None;
        }
        // SAFETY: Range is checked; allocation validity is the caller's duty.
        Some(unsafe { std::slice::from_raw_parts(pointer as *const u8, length as usize) })
    }
}

#[cfg(test)]
mod tests;
