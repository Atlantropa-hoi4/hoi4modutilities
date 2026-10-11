# Rust compute migration

## Migrated scope

The dependency-free Rust/WASM crate supplies BC1/BC2/BC3 DDS decoding, dense
24/32-bit unsigned RGB(A) decoding, 24-bit BGR province color extraction, and
province boundary traversal/concatenation plus one-pixel/X-crossing validation.
TypeScript retains VS Code integration, source parsing, file resolution,
index lifecycle, province zones/regions, text edits and Chromium rendering.
This is an incremental migration, not a wholesale extension rewrite.

- [Rust crate and ABI](../../rust/hoi4-compute/README.md)
- [Compute service](../../src/util/compute/service.ts),
  [worker](../../src/util/compute/worker.ts), and [WASM binding](../../src/util/compute/wasm.ts)
- [Raw format eligibility](../../src/util/compute/rawformat.ts) and
  [validated edge decoder](../../src/util/compute/provinceedges.ts)
- [Image cache](../../src/util/image/imagecache.ts) and
  [province adapter](../../src/previewdef/worldmap/loader/provincebmp.ts)

PNG encoding remains TypeScript but runs in the worker for eligible DDS jobs.
Float, signed, sRGB, non-eight-bit and leading-padding raw layouts use the
existing Surface decoder. In particular, XRGB/XBGR retain its legacy compact
reader behavior rather than silently changing pixels. TGA and flag resizing
remain on their existing paths.

Phase 2 also narrows the vanilla/DLC localisation index to the selected preview
language plus English; workspace localisation retains all languages and its
existing fallback. Filtering precedes URI/stat fingerprint work. Language
switches invalidate the global generation. Open-document expiry uses document
identity/version rather than wall time; initial cache tokens precede content
creation. Lint diagnostics debounce edits and reuse bounded current-version
results for actions. None of these require new public settings or commands.

## Runtime bounds and fallback

Activation registers a disposable service but does not start WASM or a worker.
One job runs at a time, with at most eight queued jobs and 128 MiB of queued
input. Each input is separately bounded to 128 MiB; serialized Rust results,
including headers, are bounded to 256 MiB. Province edge scratch accounting is
bounded to 256 MiB with fallible reservations. These are individual budgets,
**not a 256 MiB whole-process RSS guarantee**: input, growing output, exact boxed
output, copied results and JS graphs can coexist. In the extreme, kernel-side
input/scratch/output budgets alone can approach 640 MiB. Growth accounting can
reject an edge result before the nominal serialized limit.

The default threshold is 262,144 pixels, preserving the low-overhead inline
path for a single small image. During bulk image hydration, at least six active
physical image requests allow small DDS jobs to use the same bounded worker;
the existing three-decode limiter and request coalescing remain in place.
This avoids interpreting the old synthetic small-job slowdown as a reason to
leave hundreds of raw icon decodes/PNG encodes on the host thread.

Idle workers are unreferenced and retire after 30 seconds. Jobs with at least
64 MiB of decoded pixels, or WASM memory high-water of at least 128 MiB, retire
the worker. Replacement waits for termination, including cancellation paths.
The per-active-job timeout is 30 seconds.

Input is copied into dedicated transferable storage without detaching pooled
Buffers, cached arrays or offset source views. WASM views are recreated after
memory growth; owned output is copied and exact allocations are freed once.
ABI v1 still requires BCn/BGR exports; edge/RGBA8 exports are optional capabilities.

Missing optional kernels and a normal zero-pointer kernel rejection decline
only that job. They do not permanently disable unrelated acceleration. DDS
can use Surface inside the same worker without retiring a healthy old ABI
instance. Allocation rejection retires only a high-water instance. Missing
artifacts, ABI/init failures, direct-kernel traps, worker failures, timeouts or
corrupt results retain infrastructure fallback. DDS kernel faults can use the
old decoder in-worker and retire afterward. DDS content errors preserve
`UserError` identity and are not retried on the host.

The edge payload is completely validated before province graphs are mutated.
Bad payloads use the original TS traversal/validation; valid output preserves
component/neighbor/path order, seam handling and warning order/text. File reads
still use the existing fileloader, preserving unsaved content, mod/dependency
precedence, `replace_path` and optional DLC behavior. Map sessions check
cancellation around off-thread computation and before commit; a cancelled map
job may finish its shared worker stage before being discarded. Shared image
jobs are not tied to one consumer's cancellation. Editor jobs have their own
abort signal and cannot update disposed panels.

## Building and observing

Installed VSIX users do not need Rust. Developers need stable Rust and
`wasm32-unknown-unknown`; no Cargo registry dependencies are added.

```powershell
rustup target add wasm32-unknown-unknown
npm run build
npm run test:rust
npm run verify
```

`npm run build:compute` builds only WASM/worker. Builds use `--offline`, `--locked`
and an explicit Cargo target directory. CI installs the target and runs native
tests. Rust source, Cargo outputs and profiling inputs/reports are excluded
from the universal VSIX. Worker code has no runtime VS Code dependency; browser
CSP and map/focus payload protocols are unchanged.

The watcher watches worker TypeScript, not Rust. After Rust edits rebuild compute
artifacts and reload the Extension Development Host. Existing instances do not
hot-reload.

`HOI4MU_PERF_TRACE=1` mirrors local entries to debug logs.
`rustcompute.compute` reports queue/end-to-end/worker time, bytes, pixels and
actual engine. `rustcompute.unavailable` reports infrastructure failures.
`worldmap.provinceEdges.backend` confirms actual Rust or TS traversal;
`worldmap.provinceEdges` now includes edge validation. Zones remain separately
measured. `HOI4MU_COMPUTE_BACKEND=typescript` disables acceleration for that
launch; unset it for tests requiring actual worker execution.

Map debug polling can pass `{ includeRetainedSize: false, performanceLimit: 200 }`.
The default retained-size query is memoized per loaded graph and reports UTF-8
bytes, not UTF-16 character count. `loadStartedAt`, `summaryPostedAt` and
`dataCommittedAt` are host timestamps. Data commit acknowledges complete webview
data, **not final canvas paint**. Measure retained serialization once outside
latency/event-loop/memory probes.

## Measurements and verification

See [actual TNO measurements](tno-performance.md) for the real-mod before/after
comparison, input hashes, limitations and final verification. The prior phase-1
synthetic benchmark remains reproducible with `npm run bench:compute`: on
Windows/Node 24 it measured BC3 2048² at 73.7 ms TS versus 22.3 ms worker, and
4096×2048 province colors at 175.6 ms versus 53.0 ms. Those are isolated kernels,
not whole-preview gains. A 64² BC3 worker job was slower (0.191 versus 0.090 ms),
which motivated preserving the single-image threshold.

Native tests cover exact decoder arithmetic, limits and thousands of legacy
edge-oracle rasters. TS tests compare actual WASM/worker pixels/PNG bytes and
edge graphs/warnings against the original TS algorithms, including malformed
payloads, queue/cancellation/ownership, old ABI capabilities and nonfatal
rejection. Cache and localisation tests cover version/language races. Desktop
integration checks the shipped worker inside VS Code.

Remaining work includes map zones/large payload retention and transport,
more preview families, continuous-edit endurance, in-flight map signal
propagation, non-Windows execution and standalone Node 20 benchmarking. Rust
is not claimed to accelerate DOM/Canvas work or every extension feature.
