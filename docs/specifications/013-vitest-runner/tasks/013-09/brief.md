# Collect coverage on Vitest 4

Use /worker. Shape: repair. Continue after 013-08 on worker 6b240e54.

Read 015 D8, 013-08 notes and worker request f11b126c. Own src/core/code/coverage/provider.mjs, matching provider tests and this task folder; do not edit board/spec/status/bundles. First regression: run provider on actual Vitest4.1.10; its start/take options omit directory fields, so current provider writes no records. Use worker config or supported RPC payload contract for that version. Keep Vitest5 behavior, isolate:false and inspector exclusion. Commit separately from013-08/013-10. Done when before fails, after produces real correctly mapped Cezar coverage records, with regression, lint/typecheck and affected verdict. No full suite; no build in worker.
