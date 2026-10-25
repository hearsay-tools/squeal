# Wave 42.5

Repair of `cand/0.1.328` (`ef5c3c439`, branch `int/w42`), 2026-10-26, from `reviews/0.1.328.md` (FAIL: B1). One repair round, then one re-review (`docs/process.md` step 6). W1 resumes on its own branch. The coordinator picks its commits onto `int/w42` and rebuilds 0.1.328. 011-215 had no finding. N1 is the board, fixed in docs.

## R1: 011-213 B1 (resume W1 384f3924)

Use /worker. Shape: repair. Row 011-213. Read `reviews/0.1.328.md` B1 and its *Inputs for the next wave*, and 011 C5's 011-213 amendment.

Outcome: a status line never names a load retry as running at the daemon's next look unless `takeRetries` would queue that file at that look.

Seam: `retryText` and `gateClosedSince` in `src/core/status/outstanding-text.ts:195-205`, which take the earliest `gateClosedAt` over every file in a group, and the grouping in `src/core/status/standing-groups.ts:33`. First edit, offered as a lead: split a group's files that have reached the 600 s bound from those still waiting. A waiting group with different ages shows each age or a labelled range; never one file's age as every file's. A file with no gate time keeps the text it had before 0.1.328. Keep the minimum among requests for the same file and key. Do not take the maximum. Reuse `waitsText` and the existing group and output limits. Record the line forms you chose in the row's notes.

Start with tests that fail at `ef5c3c439`: two files at 600 s and 1 s; a stamped file beside an unstamped one. Assert that the fresh and unstamped paths are not named as due. Keep a control for two sessions at one key.

Owns `outstanding-text.ts`, `standing-groups.ts`, `src/core/retry/text.ts` if the waiting sentence needs a range form, and their tests. Not yours: `src/core/scheduler/`, the store format, `src/core/delivery/`, the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when the new tests fail before the fix and pass after it, lint and typecheck pass, and `squeal status --wait 60000 <changed paths>` reports them passing. No `squeal run --all` and no local full suite (`docs/process.md`, "Test runs on a shared host", 2026-10-25). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
