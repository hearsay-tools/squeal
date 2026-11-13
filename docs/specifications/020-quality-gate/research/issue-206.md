# Issue 206: `squeal code` does not keep files that read beyond their keys

Researcher, 2026-11-13. Issue [hearsay-tools/squeal#206](https://github.com/hearsay-tools/squeal/issues/206), reported on Squeal 0.1.460 from a Codex worker in hearsay-tools/squawk. Owner: spec 020 D17.3, with spec 016 D4 (one write path for observed paths). Prior research: `no-daemon-reuse.md` (row 020-38). Fix row: 020-39, released in 0.1.462.

Installed Squeal **0.1.463** (`~/.claude/plugins/cache/hearsay/squeal/0.1.463/dist/cli/squeal.mjs`, tag `squeal--v0.1.463` at `a8487146a`; `src/core/code/gate/` and `src/core/daemon/keep-request.ts` are the same at HEAD `1eeeb9186`). Control: installed **0.1.460** from the same cache. Node v26.13.0, Vitest 5.0.3. All live runs between 02:30:25Z and 02:31:40Z, one-minute load 9.42 to 11.44 on 24 CPUs, below the limit at every check. Probe: `probes/issue-206/` (README there).

This file proposes; it does not decide.

## Answers

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does the original report reproduce on 0.1.460? | **Yes.** With no daemon, `test/reads.test.ts` (reads tracked `data/table.json` at run time) is not kept in any of 3 runs, with the issue's message. Reuse per run: 0/2, 1/2, 1/2. | verified by experiment (0.1.460) |
| 2 | Does it reproduce on 0.1.463 with no daemon? | **No.** Run 1 keeps both files; runs 2 and 3 read 2/2 from the stores. No "not kept" line. Row 020-39 closed this case. | verified by experiment (0.1.463) |
| 3 | Does it reproduce on 0.1.463 with a serving daemon? | **Yes.** Same message in all 3 runs: `1 completed test file was not kept in the stores, because it read paths its key lacks (data/table.json): test/reads.test.ts`. Reuse per run: 0/2, 1/2, 1/2. | verified by experiment (0.1.463) |
| 4 | Why does the daemon case differ? | Row 020-39 merges the run's reads and keeps at the grown key only when the gate holds the worktree's daemon lock, that is, when no daemon serves. When a daemon serves, the keeper drops every file kept at a grown key and tells it as not kept (`keep.ts:245` and `#withoutGrown`, `keep.ts:336`). The `keep` request to the daemon carries no observed reads (`daemon/keep-request.ts` has none). D17.3 as amended 2026-11-13 says the same: "where no daemon serves the worktree". | read in source code (0.1.463) and spec |
| 5 | What clears it while a daemon serves? | (a) The daemon runs the file once: after `squeal run tests test/reads.test.ts --wait 60000`, gate runs 2 and 3 read 2/2 from the stores. (b) `inputs` in `squeal.config.json`, `{"inputs":{"test/reads.test.ts":["data/table.json"]}}`: all 3 runs keep or reuse both files, with no "not kept" line. | verified by experiment (0.1.463) |
| 6 | Relation to row 020-39 | 020-39 is the fix for the no-daemon half and works. The serving-daemon half is the "option 2" that `no-daemon-reuse.md` left as a second choice ("a grown file stays unkept while one does"). No board row holds it. Row 021-20 (done, 0.1.450) routes the keeper's writes through a serving daemon but adds no reads. | verified by experiment; board read 2026-11-13 |
| 7 | Was a daemon serving in the original report? | **Not determined**, because the worker's worktree and report are gone and the issue says "Daemon restart: Not tried". On 0.1.460 both cases fail, so the report fits either. | inferred |

## Findings

**Runs** (`probes/issue-206/evidence/*.jsonl`). Each case: fixture created, `src/helper.ts` changed after the base commit, then `squeal code --base main --json --timeout 60` three times on the same bytes. "Read" counts the files with `from: "store"` in the JSON report.

| Case | Version | Run 1 read / not kept | Run 2 read / not kept | Run 3 read / not kept |
|---|---|---|---|---|
| no daemon | 0.1.460 | 0/2 / 1 | 1/2 / 1 | 1/2 / 1 |
| no daemon | 0.1.463 | 0/2 / 0 | 2/2 / 0 | 2/2 / 0 |
| serving daemon (lookup-only, files unknown) | 0.1.463 | 0/2 / 1 | 1/2 / 1 | 1/2 / 1 |
| serving daemon, daemon runs `reads` after run 1 | 0.1.463 | 0/2 / 1 | 2/2 / 0 | 2/2 / 0 |
| serving daemon, `inputs` declared | 0.1.463 | 0/2 / 0 | 2/2 / 0 | 2/2 / 0 |

Every run passed and exited 0. Each gate run took 0.9 to 1.5 s. The daemon's `squeal status --wait 30000` showed "not current: 2 of 2 test files (2 unknown)": its lookup-only start ran nothing, so it had no observed reads for the gate's key.

**Why the daemon run clears it** (read in source code; inferred for the mechanism). The daemon's own record merges the run's reads into the shared `observed*` rows (spec 016 D4's one write path). The gate copies those rows into its keys before the run (`gate/stored.ts`, per `no-daemon-reuse.md`), so the next gate run reads nothing beyond its key, and the daemon's stored result is at that key.

**Why the issue's counts fell from 15 to 11** (inferred, not run). With a serving daemon, any daemon run of 4 of those files between the two gate runs would add their reads to the shared rows and make them keepable. The issue's "4 of 178 selected test files read from the stores" fits that, but the report is gone.

**The message.** It names the read paths but no remedy. The issue asks for the `inputs` entry. Spec 011 defines `inputs` as a list for all test files or "a map from test-file glob to input globs" (`011-core/spec.md`, configuration keys). Case 5b shows the map form works for this. Spec 020 D14.4 (row 020-34) already names `inputs` in the node:test closure notes; the D17.3 not-kept line does not. Read in source: `gate/keep-reasons.ts`, kind `grown`.

## Recommendation for Squeal (a proposal)

The issue is half fixed. Row 020-39 (0.1.462) closes it where no daemon serves. It stays open where a daemon serves the worktree, as in an agent session whose Squeal hooks started a daemon (inferred; not measured how often). Two choices for the human, not exclusive:

1. **Serving-daemon half of 020-39** (option 2 of `no-daemon-reuse.md`): the keeper sends the run's observed reads with its `keep` request, and the daemon merges them and stores at the grown key in its retried path, as its own record does. Gain: the gate reuses run-time readers on the second run with or without a daemon. Cost: a field in the `keep` request and a merge in `daemon/keep-request.ts`; no key format change (read in source, not built).
2. **Name the remedy in the message**: the `grown` line adds the `inputs` map entry for the files and paths it lists, or points at `squeal run tests <files>` to let the daemon learn them. Cheap, but declared inputs re-key those files on every change to the listed paths, and the human must keep them true.

Option 1 matches the issue's first expectation and the behaviour 020-39 already gives without a daemon. Option 2 alone leaves the rerun in place until someone edits the config.

## Open questions

1. Whether a daemon served the original worker (question 7). A repeat in a Codex worker on 0.1.463 with `squeal status` captured before the gate would settle it.
2. The issue's paths (`packages/cezar/src/automations/*.ts`, a `package.json`) may be read by child processes of multi-runner parity tests. This probe read in the test process only. Whether child-process reads reach the gate's observed reads was not tested here.
3. A git-ignored run-time read is kept one run later on 0.1.463 with no daemon (D17.3 amendment). Not tested here.
4. One tiny fixture. The share of a real selection that a serving daemon leaves unkept depends on how many selected files the daemon has run before; `no-daemon-reuse.md` measured 77% where it had run none.

## Sources

- Issue: `gh issue view 206 -R hearsay-tools/squeal`, read 2026-11-13T02:29Z.
- Specs: `../spec.md` D17.3 (amended 2026-11-13, row 020-39) and D11.7; `../../016-extensions/spec.md` D4; `../../011-core/spec.md`, `inputs` key.
- Research: `no-daemon-reuse.md` (row 020-38).
- Board: `docs/board.md` rows 020-38, 020-39, 021-20, keep-observed-without-daemon; `../status.md` 2026-11-13 entries.
- Source at `squeal--v0.1.463` (`a8487146a`): `src/core/code/gate/keep.ts` (lines 233-245, 335-341), `keep-reasons.ts`, `keep-write.ts:280`, `src/core/daemon/keep-request.ts`.
- Probe and evidence: `probes/issue-206/probe.mjs`, `probes/issue-206/README.md`, `probes/issue-206/evidence/`.
