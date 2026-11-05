# v0.6.0: range-backed PSD import

PSD/PSB import now reads File slices: a metadata-only skeleton is passed to the pinned ag-psd parser, and channel payloads are fetched only for the layer currently being converted. Encoded channel arrays are released before persistence. Fingerprinting remains chunked. There is no whole-file size cap; per-layer decoding and metadata safety bounds remain.

Storage still writes immutable PNG Blobs and publishes the manifest only after image transactions finish. Base64 decoding yields between 1 MiB blocks, and metadata walks yield every 32 traits. Existing saved projects are preserved. In-memory project PNG strings and hydration of saved projects remain scalability limitations; this change does not claim arbitrary projects fit iPhone memory.

Validation: complete npm test suite; pixel-for-pixel streamed vs original PSD/PSB raster comparison (raw/ZIP, hierarchy, hidden layers, positions, masks, opacity), 16/32-bit fixtures, group masks, 610-layer range reader, a sparse file reporting >4 GiB without whole-file reads, truncated-input rejection, worker and fallback UI, resume/cancel, storage rollback/retry and responsive metadata saves. Sparse test verifies addressing and no full read, not a real 4 GiB import benchmark. No physical iPhone or user's PSD available. User reports crash during saving; memory reduction addresses a known pressure source but exact device crash cause is not confirmed.

Home-screen and manifest icons use the supplied EDEN avatar with aspect ratio preserved.
