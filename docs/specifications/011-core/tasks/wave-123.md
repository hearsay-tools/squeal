# 011 wave 123: test slots stop capping busy CPUs; a hung beside file is reported; folder paths, the status JSON reference and the lint line

Rows 011-404 to 011-407, 017-32 and 017-33. Coordinator 4abb5168, 2026-11-19 (the human approved this round on coordinator b99e3c05's card; W3 to W5 from the human's card of 2026-11-19 to coordinator 4abb5168: "Folder selects tests", "Name tool + coverage", "Diagnose + show the wait"). W1, W2, W3 and W4 run in parallel on disjoint seams; W5 starts on the integrated head after W1. One candidate (0.1.570), one review.

Rules for every worker: no version raise, no `pnpm run build` in your worktree, no full suite. `test/e2e/**` is outside Squeal's coverage: grep ALL of `test/` for paths you change and run each such e2e file directly, one at a time, `timeout 900`. Every direct `vitest` run gets `timeout`. Before you report, read `squeal status --wait 60000 <changed-path>...`. Write `~`, never a `/home/<user>/` path; no company or VM host names. Notes in `tasks/<row>/notes.md` with the proposed spec amendment in plain text; the coordinator lands spec and status edits.

## W1: 011-404 test slots stop capping busy CPUs (gh-225)

Use /worker. Shape: slice. Outcome: a background tier (backlog, baselines) takes a permit while the busy CPUs it counts are below the CPU ceiling (`capacity.backgroundShare` of the CPUs, default 0.75) alone; `capacity.hostSlots` no longer lowers that bar. Slots still count test runs: the permit files and each daemon's fair share stay sized by `hostSlots`.

Why: the human, 2026-11-19 (021 `status.md`): slots acting as a busy-CPU bar is not intended. Evidence: `021-remote-store-and-execution/research/cpu-ceiling-measured.md` (hostSlots 6 made the bar 6 busy CPUs on a 24-CPU host). Read 021 spec D18, 011 spec C10 Size and "A pool wait is told", `research/broad-change-throughput-2.md` section 4.

First edit: `src/core/capacity/cores.ts` `gatedPermits`, background branch: the limit is `background.ceiling`, also when `busy` is unread (then the marks' cores count against it). Then `ceilingRefusalLine` (`background.ts`) loses its test-slots clause, and every reader that shows the bar follows: `src/core/ps/host.ts`, `src/core/runner-host/remote/admission.ts`, the pool wait facts (`src/core/scheduler/pool-wait.ts` where it names the bar; its "N of M test slots" count stays). Leave the checkpoint branch (`cores < hostSlots || grants < hostSlots / 2`) unchanged; say in notes whether any text still calls slots a CPU bar. Second part (021-19 recommendation 4, agreed with spec 021's coordinator 585446dc): the daemon logs one refusal line per refusal episode, not one per look (`pool.ts` `#logRefusal`; 490,833 lines in 4.5 days on this host): the first refusal of a waiting tier logs, later ones stay quiet until a permit is granted or the wait ends; the episode's end may log one line with its length.

Owns: `src/core/capacity/**`, `src/core/ps/host.ts`, `src/core/runner-host/remote/admission.ts`, `src/core/scheduler/pool-wait.ts`, their tests. Leave alone: `src/core/scheduler/{overrun,yields}.ts` (W2), spec files.

Done when: a test with `hostSlots` 6, ceiling 18 and 10 busy CPUs grants a background permit (fails before the change); one at 18 busy refuses; the refusal line names the ceiling only; 100 refused looks in one wait log one line; existing checkpoint gate tests unchanged and passing.

## W2: 011-405 a hung beside file is reported (N1 of `reviews/0.1.567.md`)

Use /worker. Shape: repair. Outcome: when the tier running beside an overrunning one also passes its own overrun threshold, status, the named wait and the late line report its files as overrunning, as they report the first tier's. No third instance opens: at most two tiers per lane, as now.

Read: `reviews/0.1.567.md` N1, `-r2.md` and `-r3.md` on 011-399; spec 011 C4 step 5 and C6 (overrun facts); `tasks/wave-122.md` W4.

First edit: `src/core/scheduler/overrun.ts` `overrunAt` returns `null` for `tier.beside === true`, which serves two purposes. Split them: one function says when a tier's files are reported as overrunning (beside tiers included), another says whether its lane may open the next instance (`overrunLanes`, beside excluded as now). Then the publish path in `yields.ts` (`Overruns`) uses the first for the facts.

Owns: `src/core/scheduler/{overrun,yields,yield-waits}.ts`, the status overrun facts and their texts where they need a change, their tests. Leave alone: `src/core/capacity/**` (W1), spec files.

Done when: a test holds the original tier and its beside tier past both thresholds: both tiers' files appear in the published overruns (text and JSON), there are still exactly two tiers in the lane, and no stored result changes. The 011-399 tests pass unchanged.

## W3: 011-406 a folder selects the test files under it, then 011-407 the status JSON reference (gh-169, gh-242)

Use /worker. Shape: slice, then a docs finish. One worker, two commits in this order.

**011-406.** Outcome: `squeal status [--wait] <folder>` selects the listed test files under a real folder (`.` or the root: all), with a line such as `Directory: test/commit; it selects the 10 listed test files under it` and JSON `selection.paths[].kind: "directory"`. Source files under the folder are not expanded. Files picked through a folder are not promoted, asked or focused (only an exact test path is). A path that is neither a file nor a folder stays unmatched (exit 3); its message names the listed test files whose path starts with it (`it is not a file or folder; 2 listed test files start with it: …; name them`) and selects none. Read: `011-core/research/issue-169.md`, spec 011 C6 and C15, 005 D2. First edit: `src/cli/named-selection.ts` (the loop near 122-137, `unmatchedOf`), reusing the "path or below it" rule of `src/core/commit/at-keys-narrow.ts` `selects`. A folder is on the "can grow" side of `verdict.ts` `fixedSelection`. Done when: tests beside `test/cli/status-wait-mixed.test.ts` for a folder (snapshot and wait), the root, folder plus exact path without duplicates, an empty folder (exit 3), a folder while unlisted (`complete: false`, "at least"), a prefix hint (exit 3), a source path unchanged, a folder not promoted.

**011-407.** Outcome: a "Status JSON" section in the skill's `references/commands.md` that names every `selection.result` and `reason` with its meaning and precedence, `selection.complete` (not a verdict), `selection.verdict` fields, `outcome` values, `code` and exit codes 0/1/2/3, the store-unavailable shape (`available: false`, no `selection`), and that empty or invalid output after a killed command is never a Squeal answer; with short examples. `squeal status --help` points to it. Read `011-core/research/issue-242.md` ("closed reason set"). Edit `plugins/claude-code/skills/squeal/references/commands.md` and mirror it byte for byte into the codex-runtime and pi copies (and the Codex seed if a test requires it).

Owns: `src/cli/{named-selection,named-path-lines,named-file-lines}.ts`, `src/cli/wait/**` where a folder needs it, the `status` help in `src/cli/main.ts`, `plugins/*/skills/squeal/references/commands.md`, their tests (`test/harness/skill-wait.test.ts` included). Leave alone: `src/core/**` beyond the `NamedPath` kind type, `src/core/commit/**` (W4).

## W4: 017-32 the commit lint line names its tools and coverage (gh-237, gh-219, gh-170)

Use /worker. Shape: slice. Outcome: the commit summary's lint part never reads as a whole-repository pass it is not. It names the tools that checked (`lint (oxlint): 0 findings in 7 of 7 files`), puts the zero only on complete evidence (`lint (oxlint): 4 of 7 files still running, 0 findings so far` or the worker's better wording with the same facts), counts files, not checks, and says when lint is on but no tool checked anything (`lint not run (…reason…)`). Other lint commands (ast-grep, a project's `lint` script) stay unsupported; the tool name is the scope. Read: `017-lint-checks/research/issue-237.md`, `issue-219.md`, `issue-170.md`; spec 017 D2, D8, D11; spec 019 D5 and D6. First edit: `src/core/commit/lint.ts` (the counts gain the tools and the total) and `src/core/commit/text.ts` (the line). The JSON report gains fields additively; say in notes whether its version moves.

Owns: `src/core/commit/{lint,text,report}.ts`, the commit report type, `plugins/*/skills/squeal/references/reports.md` (three copies, byte for byte), their tests (`test/commit/text.test.ts`, `test/scheduler/commit-lint.test.ts`, `test/scheduler/commit-report.test.ts`, `test/e2e/run-triggers.test.ts` run directly). Leave alone: `src/core/lint/pass/**` (W5), `src/cli/**` (W3). Done when: tests for complete clean, complete with findings, running, not determined, two tools, lint on with no tool run, and that a clean oxlint pass no longer prints the bare `lint 0 findings`.

## W5: 017-33 lint status names its CPU wait (gh-238); after 011-404 is integrated

Use /worker. Shape: slice. Outcome: while lint work waits for the background CPU limit, `squeal status` and its JSON say so, with the numbers the pool read: `Lint: linting, 0 of 3,457 files; waiting for CPU (21 busy, limit 18)`. No scheduling change. Read: `017-lint-checks/research/issue-238.md`, spec 017 D7/D9, spec 011 "A pool wait is told" and how test tiers publish their pool wait (`src/core/scheduler/pool-wait.ts`). First edit: where `src/core/lint/pass/parts.ts` (about 257) takes its background lease, record the refused gate facts; `src/core/lint/surface/snapshot.ts` reports them. Owns: `src/core/lint/pass/**`, `src/core/lint/surface/**`, their tests. Leave alone: `src/core/capacity/**`. Done when: a test with the lease refused shows the wait in text and JSON, and a granted lease shows none.
