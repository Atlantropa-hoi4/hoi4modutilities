# hoi4-compute

Dependency-free Rust computation for BC1/BC2/BC3 DDS pixels, packed RGB(A)
bytes, 24-bit BGR province bitmap rows, and province boundaries/validation.
The safe `decode_bcn`, `decode_rgba8`, `scan_bgr` and `scan_edges` functions
work on native targets; the pointer ABI is exported only for `wasm32`.

## ABI v1

All arguments, pointers, and return values are `u32`. `abi_version()` returns
`1`. The WebAssembly module exports its linear `memory`.

- `allocate(length)` returns a pointer to an exactly `length`-byte, zeroed
  `Box<[u8]>`. Zero lengths, lengths above 128 MiB, or reservation failures
  return `0`.
- `deallocate(pointer, length)` frees the exact box originally allocated.
  Free input buffers using their allocation length, and result buffers using
  their header's total length. A null pointer is a no-op.
- `process_bcn(input_ptr, input_len, width, height, format, premult)` accepts
  formats `1 = BC1`, `2 = BC2`, `3 = BC3`, and `premult` values `0` or `1`.
  Pixels are RGBA bytes; the unique color count is zero.
- `process_bgr(input_ptr, input_len, width, height, stride)` accepts original
  BGR rows with `stride` bytes per row, including padding. Pixel values are
  little-endian `u32` values of `0x00RRGGBB`. Output rows are reversed. Unique
  colors follow the first encounter in source row order, then ascending x.
- `process_rgba8(input_ptr, input_len, width, height, bytes_per_pixel, offsets)`
  accepts packed 3/4-byte pixels. The four bytes of `offsets`, least significant
  first, are R/G/B/A byte offsets; A=255 means opaque alpha. Output is RGBA
  with no unique-color tail. The TS adapter restricts eligibility to dense,
  zero-start eight-bit unsigned RGB(A) layouts to preserve Surface semantics.
- `process_edges(input_ptr, input_len, width, height)` accepts exactly
  `width * height` little-endian u32 24-bit colors in logical raster order.
  Its header uses the second word as payload byte length and unique count zero.
  Payload LE u32 words begin `[version=1, groupCount, onePixelCount, crossingCount]`.
  Each component-neighbor group has `[fromColor, toColor, pathCount]`, followed
  by paths `[pointCount, x, y, ...]`. `toColor=0xffffffff` is outside the map.
  One-pixel records `[color, x, y]` and crossing records `[x, yTop]` follow.
  Per-component neighbor/path order and raster traversal match the old TS code;
  the adapter merges repeated color-neighbor groups and formats warnings.

Edge/RGBA8 exports are additive optional capabilities under ABI v1. Bindings
can continue using older BCn/BGR modules and decline unsupported kernels.

A successful process call returns an independently owned boxed result. Errors
return `0`; the input remains owned by the caller. The result starts with three
little-endian `u32` fields (12 bytes): total byte length, pixel byte length,
and unique color count. Pixel bytes follow, then unique colors as little-endian
`u32` values. Input lengths are limited to 128 MiB and complete serialized
results to 256 MiB. Dimensions must be nonzero. BGR requires `width * 3 <=
stride` and at least `stride * height` input bytes. BCN requires all complete
4x4 blocks, including blocks clipped at image edges. Extra input bytes are
ignored, but still count toward the input size limit.

### Pointer safety contract

This is a **trusted allocated-buffer ABI**, not an allocation registry. Process
inputs must point to a live allocation returned by this module's `allocate`,
with `input_len` no larger than its original allocation length. Calls must not
mutate or free that input while processing. Deallocation must use an original
allocation pointer and its exact original length, once only. Results also must
be freed once only using their total length. Numeric size and linear-memory
range checks cannot establish allocation ownership or prevent a caller from
violating these rules. The native build omits the pointer exports so a 64-bit
native pointer cannot be truncated into this ABI.

Allocations can grow WebAssembly memory. Recreate JavaScript views from
`memory.buffer` after allocation and processing calls; read the result header
before deallocation.

## Compatibility

BCN decoding preserves `src/util/image/dds/surface.ts` arithmetic: RGB565
scaling and weighted color interpolation use `f64` followed by floor, BC1
uses transparency when `color0 <= color1`, and BC2/BC3 always use four colors.
Both BC3 alpha interpolation branches intentionally divide by **7**, matching
the current JS implementation (including its lower-endpoint branch).
Unpremultiplication evaluates `channel / (alpha / 255)` and truncates modulo
256, matching `Uint8Array` assignment; it does not clamp. Zero alpha leaves
RGB unchanged. Partial blocks are clipped without changing block traversal.

BGR scanning uses a 2 MiB, 24-bit seen-color bitset and appends ordered unique
colors directly to the serialized result, without per-pixel hash lookups.
Size arithmetic and input extent checks precede allocation and pixel access;
dynamic buffer growth uses fallible reservations.

RGBA8 evaluates `value / 255 * 255` in f64 followed by truncation, including
legacy rounding for both unsigned/unorm values. It does not add sRGB, signed,
float, premultiplication or padded-layout interpretations.

Edges preserve left/top/right/bottom stack order, horizontal wrap, top/bottom
sentinels, numeric adjacent-color order (sentinel last), legacy first-unvisited
endpoint selection and collinear reduction. The aggregate scratch budget is
256 MiB, with checked/fallible growth. Input, scratch and exact output can
coexist; this is not a total linear-memory ceiling. Growth accounting can
reject below the serialized output cap. Normal zero-return rejection is a
per-job accelerator decline, not necessarily a trapped/invalid instance.

## Checks

From the repository root:

```powershell
cargo fmt --manifest-path rust/hoi4-compute/Cargo.toml
cargo test --offline --manifest-path rust/hoi4-compute/Cargo.toml
cargo build --release --offline --target wasm32-unknown-unknown --manifest-path rust/hoi4-compute/Cargo.toml
```

The release artifact is
`rust/hoi4-compute/target/wasm32-unknown-unknown/release/hoi4_compute.wasm`.
Native unit tests use the safe functions rather than the wasm32 pointer ABI.
