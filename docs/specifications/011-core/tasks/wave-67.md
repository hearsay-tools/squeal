# Wave 67: rows 011-291 and 011-292 (from quality `2026-10-31.md`)

Coordinator 63577e87, 2026-10-31. The human approved both rows (decision cards in status task a19e8156, "011-291: Approve" and "011-292: Approve"): one release for the two, after and separate from the key-format release 0.1.388 (wave 66). Version 0.1.389 is planned for it. Neither row touches key code.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, bundles, `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`. Wave 66 runs at the same time and owns `src/core/scheduler/{keying,batch,reconcile}.ts`, `src/core/keys/**`, `src/core/store/**`, `src/core/types/{store,runner}.ts`, `src/runners/**`: leave them alone.

## W1: row 011-291 (the slow tier records which capacity it waits for)

Use /worker. Shape: slice, test first.

Outcome: a full worker pool with a free slow slot reads "waits for the shared worker pool" in `squeal retry`, `Outstanding:` and `Slow tier:`, text and JSON (`for: "pool"`); a taken slot reads the slow slot; a stored `slot` from an older daemon reads as today.

Read: the board row 011-291; `quality/2026-10-31.md` ("Board rows"); spec 011 C5 and 004 D8.

Seam and lead: `src/core/scheduler/slow-tier.ts:262`, the refused pool permit, which publishes `{kind: "waiting", for: "slot"}`; publish `"pool"` there. Add `"pool"` to `SlowTierWait` (`src/core/types/status.ts:128`) and the reader's set (`src/core/slow/state.ts:45`), then the words in `holdText` and `WAITING_FOR`.

Owns: `slow-tier.ts`, `src/core/slow/state.ts`, `src/core/state/slow-text.ts`, `src/core/retry/text.ts`, `src/core/retry/waits.ts`, `src/core/types/status.ts`, their tests. Leave alone: `src/cli/named-*.ts` (W2 splits that file; if the words must change there, send the coordinator a request first).

Done when, red before and green after: `test/status/retry-holds-live.test.ts`'s pool case asserts the exact words; a taken slot and an older daemon's `slot` keep today's words, text and JSON; lint and typecheck pass. Name the C5 and 004 D8 lines to amend in your final message (the coordinator edits the spec).

## W2: row 011-292 (nine small removals and merges)

Use /worker. Shape: finish, one commit per slice.

Outcome: slices 1 to 9 of `quality/2026-10-31.md` are done; no output text changes.

Read: `quality/2026-10-31.md` "Slices" (all nine) and the board row 011-292.

Seam and lead: slice 1, `src/core/scheduler/promotions.ts:167` and `yields.ts:72-75`; then slices 2 to 9 in order. Line numbers are as of 0.1.387.

Owns: the files the nine slices name (`src/core/scheduler/{promotions,promotions-row,yields}.ts`, `src/harness/shared/hand-off.ts`, `src/harness/pi/{worker,protocol}.ts`, `src/harness/opencode/bridge.ts`, `src/core/delivery/prepared.ts`, `src/core/fs/git-layout.ts`, `src/cli/{stop,stop-removed,stop-waits,named-file-lines}.ts`, new `src/cli/named-step.ts`) and their tests, `test/harness/opencode/held-answer.test.ts`. Leave alone: W1's files.

Done when: each slice's file and line no longer holds the copy or dead code; no output text changes; affected tests pass (`squeal status --wait`); lint and typecheck pass. Stop and report any slice whose change would alter output, order or a commit point; skip it rather than widen it.
