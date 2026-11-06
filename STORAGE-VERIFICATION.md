# Storage verification — 2026-11-06

Verified application source at commit 55022b75ea18dfdcfdcca74245d1d6048f7493ec (v0.6.0). Full npm test suite passed, including masks/pixel parity, 610-layer range parsing, worker/fallback import UI, resume/cancel, history/drag, quota failures, transaction rollback and retry.

Additional reproducible stress test: `node tests/storage-stress.cjs`. 610 distinct valid 256 × 256 random RGBA PNGs, 153 MiB encoded total. Native Blob and canvas, Node and fake-indexeddb; NOT Safari or physical-device persistent storage.

| Operation | Time | Image writes | Largest observed 10 ms timer delay |
| --- | ---: | ---: | ---: |
| Initial save | 0.78 s | 610 | 2.0 ms |
| Metadata-only save | 0.03 s | 0 | 0.4 ms |
| Restore and verify every image | 0.40 s | 0 | 81.6 ms |

These are one-run diagnostic observations, not performance guarantees or thresholds. Real disk writes, Safari quota behavior and mobile garbage collection are not reproduced by fake-indexeddb. No device telemetry was collected. The user's earlier crash during saving cannot be attributed conclusively from these results.

Process RSS was approximately 725 MiB after save and 1209 MiB after restore; this includes the in-memory mock database, original fixtures, restored copies, encoder allocations and test runtime. It is NOT an estimate of iPhone RAM use. Nonetheless the source confirms a remaining scaling limitation: restored PNG Blobs are all converted to Base64 strings before opening the project. On-demand image access requires a coordinated change to model/rendering/export/history and should not be described as already implemented.

No production behavior changed in this verification commit.
