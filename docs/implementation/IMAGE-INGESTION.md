# Exact local keyframe ingestion

`LocalImageStore` validates returned PNG bytes independently of the cloud transport. It is a trusted host service, not a model tool, upload endpoint or generation grant. No cloud provider is enabled by this component.

The host supplies recorded SHA-256 and expected dimensions with the bytes. Ingestion copies all input before the first asynchronous operation, rejects mismatching format/hash/header geometry and writes a private staging snapshot. FFprobe must observe exactly one PNG frame at the expected dimensions; FFmpeg then decodes with error checking before publication. The encoded source bytes are preserved, so normalization cannot silently change a reviewed conditioning image.

Publication uses an exclusive hardlink to a content-addressed PNG path. Existing entries are checked as regular, nonsymlink files and rehashed; conflicting content is never replaced. Data and containing-directory synchronization precede success. Concurrent identical images can reuse one blob. The returned immutable descriptor includes geometry, hash, byte size, host path and a validation digest binding the media tools. The application must still create an owned artifact record and attach project/attempt lineage before exposing it to review.

Limits are 32 MiB encoded bytes, edges no larger than 4096, and at most 8,294,400 pixels. Each media subprocess has a bounded deadline/output and uses one decoder thread with file-only PNG input. This is not an OS memory sandbox or measured concurrency limit; the host must schedule ingestion within its resource allowance. Only PNG is supported in this initial output path. JPEG/WebP references, resizing and thumbnails require separately validated derivatives.

Cancellation is checked before publication and after awaited cleanup. An abort racing publication may leave a valid unreferenced immutable blob; it must not delete a blob another request reused or return a successful descriptor after observing cancellation. The caller retains the provider outcome and may retry local ingestion without submitting another paid generation.

Tests use synthetic local PNGs: complete decoding/exact byte reuse, input mutation after dispatch, malformed metadata, truncated data with a valid header, corrupted/symlinked storage and cancellation. No media APIs or user images are used. This service is not yet wired to cloud completion handling.
