# Wave 49

From main (`2663ee397`, code 0.1.333; 0.1.334 is in review on other files), 2026-10-26. The human's card of 2026-10-26: 011-234 "build the fix now", gh-99 option A+ (row 011-243), 011-235 "yes". Three rows on disjoint seams. Host load is about 13 on 24 CPUs. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-234, a source path selects the readers from this worktree's own closures

Use /worker. Shape: slice. Row 011-234; `research/source-path-selection.md` (findings 1 and 3, the recommendation); spec 005 D2.

Outcome: with a daemon, a named wait on a source path selects every test file whose closure in this worktree's key index holds it, so a failing or queued reader is never passed over; with no daemon, today's store rule stays.

Seam: `selectNamedFiles` (`src/cli/named-selection.ts:75`), called at `src/cli/status-paths.ts:93` and `src/cli/status-wait-paths.ts:290`. First edit, offered as a lead: a daemon read request beside `promote` (`src/core/daemon/protocol.ts:64`, `handlers.ts:295`, `front-desk.ts:79`) that answers a list of paths with `keys.index.reverse.referencing` (`src/core/keys/reverse-index.ts:67`) at the daemon's synced revision; the selection uses its answer for non-test-file paths, else the store rule. Keep the line "it selects the N test files that read it" true (`src/cli/named-path-lines.ts`).

Owns those CLI and daemon files, `src/cli/named-path-lines.ts`, a new module if needed, and their tests. Not yours: `src/cli/status-wait-lines.ts`, `verdict.ts` and `named-file-lines.ts` (W2), `src/core/daemon/full-check.ts` (W3), the board, spec text, `status.md`, bundles, version. No `npm run build`. A request type or JSON change is a request to the coordinator first.

Done when the research fixture's steps S1, S3, S6b and S7b select all 13 readers with a daemon; a wait on a source path with one reader failing exits 1, and with one queued holds for it; no daemon gives today's selection; the evals parser gate round-trips any changed line.

## W2: 011-243 (gh-99), a wait with no verdict names what its passes cover and the next step

Use /worker. Shape: slice. Row 011-243; `research/issue-99.md`; #99's output; `quality/2026-10-26-a.md` slice 1.

Outcome: a named wait that ends without a verdict says which revision its passes cover, that a later pass is not reported and a failure arrives with a later tool call, and gives the command to wait again; exit 3 and the verdict rule stay.

Seam: `timeoutText` and `unsyncedText` (`src/cli/status-wait-lines.ts:397-431`) and `noVerdictText` (`src/cli/verdict.ts`). First edit, offered as a lead: slice 1 (branch on `result.reason`, words only in `unsyncedText`), then the next-step sentence from the selection's reason. A longer deadline in the command only where Squeal has the figures (queued count, C10 durations); never an invented one.

Owns those three files and `src/cli/named-file-lines.ts`, the plugins' `skills/squeal/references/commands.md` (claude-code, codex, pi: the same sentence, "After exit 3, run the same wait again before you report a result"), and their tests. Not yours: W1's files, the board, spec text, bundles, version. No `npm run build`. Send the exact new lines to the coordinator as a request before you commit them.

Done when #99's case (passes at revision 6, revision 7 unlisted, deadline passed) prints the example in the row; a wait at a pending tier and one with no daemon give their own next step; `--json` is unchanged except additive fields; the evals parser gate round-trips every changed line.

## W3: 011-235, a full check gives its claim back on one rule

Use /worker. Shape: slice. Row 011-235 (scope from `quality/2026-10-26-b.md`); `tasks/011-229/notes.md`.

Outcome: the full check gives its claim back in one `finally` unless the check answered, so a throwing start, an unrun check and a stop share one rule.

Seam: `FullCheckOwner` (`src/core/daemon/full-check.ts:188`, `#start`, `#giveBack`). `RELEASE_WITHIN_MS` (`:155`) is set from `DAEMON_START_BUSY_TIMEOUT_MS` (`src/core/daemon/open.ts:56`, import only).

Owns `src/core/daemon/full-check.ts` and `test/daemon/full-check*.test.ts`. Not yours: other `src/core/daemon/` files, W1's and W2's files, the board, spec text. No `npm run build`.

Done when the row's done-when holds: a throwing start gives the claim back at once and another daemon's later start claims and runs; `#giveBack` has one caller; no `120_000` in `full-check.ts`; the three full-check test files pass.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. Squeal's selection of a source path can miss readers (row 011-233): run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Never open a live store, socket or permit pool from a probe. Make no CPU load on purpose.
