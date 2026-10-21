# Wave 10 of spec 011

## W1: 011-20, the stop-gap e2e race

Use /worker. Shape: repair. The human, 2026-10-21: fix now.

Outcome: `test/e2e/stop-gap.test.ts` passes on CI's Node 22 shard 2/3 under load, because the race behind its six sightings is named and fixed, in the code or in the test's premise.

Read board rows 011-20 (six CI runs, two shapes) and 011-08 (the stop mark holds until the next edit or `squeal start`), and the test's header (001-340, 001-355). Evidence: `gh run view <id> --log-failed` for 39141267519, 39576507169, 39628123539, 39648758886, 39657056174 and 39658902847. Shape 1: the SessionStart after the edit in the gap reads `The daemon is stopped by request` at `:58`. Shape 2: it reads `registered at revision 0`, the replacement already serving.

Seam: `livenessSentence` in `src/core/delivery/header.ts`, and the mark's tree check in `src/cli/stop.ts` and `src/core/daemon/escaped.ts`. A lead, not a ruling: shape 2 may be a right outcome the test does not admit; shape 1 may be an edit inside the mark's mtime tick. Reproduce each first with fewer CPUs (`taskset -c 0-1 npx vitest run test/e2e/stop-gap.test.ts`, the file excluded from Squeal), never by loading the shared host.

Owns: `test/e2e/stop-gap.test.ts`, `test/e2e/restart-evidence.ts`, the source the cause names in `src/cli/stop.ts`, `src/core/daemon/` or `src/core/delivery/header.ts`, and their unit tests. Not yours: other e2e files, the board, spec text, bundles, version.

Done when: each shape is reproduced, or `tasks/011-20/notes.md` says why not and what evidence stands instead; the fix turns the reproduction green; the test still proves 001-340 (stop waits for its lock, the replacement serves); no other test weakened; the file passes 10 runs in a row at the reproduction's CPU limit; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted), their output in your summary.
