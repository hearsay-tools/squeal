# Issue 42: scoped status snapshot

Recommendation: treat [issue 42](https://github.com/hearsay-tools/squeal/issues/42) as a contract change, not a defect: shipped 0.1.222 refuses and orders output exactly as 011 C6 and 005 D2 specify, so a scoped snapshot needs a spec amendment to C6/D2 and a change to the test that pins the refusal.

## Scope and verdict

**Reproduced.** Both reported behaviours reproduce on shipped 0.1.222: paths without `--wait` exit 2 with the usage error, and `--wait 1 <path>...` prints the full worktree snapshot, including 20 listed unrelated files without a result, before the selected files' lines and verdict.

Examined 2026-10-19, Squeal **0.1.222** (installed plugin bundle `~/.claude/plugins/cache/hearsay/squeal/0.1.222/dist/cli/squeal.mjs`; `squeal --version` on the PATH also prints 0.1.222), Node **v24.21.0**, source checkout `ccb2d700`. Tag `squeal--v0.1.222` resolves to commit `1612b9e0`; `git diff --stat squeal--v0.1.222 HEAD -- src/cli src/core/status` is empty, so the source read below is the shipped source. Load at the live probe: **9.20 / 18.63 / 20.29** on **24 CPUs** (one-minute below the CPU count, so the probe ran). No build, full suite, product, spec, status, skill or board change. Existing holds stand.

The probe ran in the main checkout `/home/agent/projects/squeal` (revision 837, no daemon running, no dependencies installed, 468 test files without a result). Snapshot status only reads the store; the named wait's daemon sync only connects and spawns nothing (`src/cli/status-sync.ts:43`), and with no daemon no `promote` request lands. This worktree's own store could not serve: its daemon had not listed the test files (no dependencies installed).

## Questions answered

| Question | Answer |
| --- | --- |
| 1. Does 0.1.222 reject one and multiple paths without `--wait`? | **Yes, verified by experiment (E1).** One path, two paths and `--json` with a path each exit 2, stdout empty, stderr `squeal status: takes paths only with --wait <ms>` followed by the full usage text (79 lines). **Read in source code (S1):** intended and pinned by a test. |
| 2. Does `--wait 1` include unrelated state before the selected verdict? | **Yes, verified by experiment (E2).** 40 stdout lines; the first 35 are the worktree snapshot (counts of 4400 checks, daemon, inheritance, 468 files without a result with 20 listed, notes); the selection's three lines come last. `--json` puts the whole snapshot on stdout (421 lines) and the three lines on stderr. **Read in source code (S2):** this is D2's specified order. |
| 3. What remains unverified about unknown, pending and passing selected states? | Only the **unknown** class with **no daemon** was observed (exit 3). Pending (queued, promoted, running, claimed, slow, unlisted revision), passing, failing and stale selections, and inherited-provenance lines with a live daemon, were **not reproduced**; their rendering is **read in source code** only (S3). |

## Experiments

Command, from this worktree root (probe in `research/probes/issue-42/`, throwaway):

```sh
docs/specifications/011-core/research/probes/issue-42/probe.sh /home/agent/projects/squeal \
  ~/.claude/plugins/cache/hearsay/squeal/0.1.222/dist/cli/squeal.mjs \
  test/cli/main.test.ts test/cli/remove.test.ts
```

Full output: `research/probes/issue-42/output.txt`.

**E1, refusal.**

```text
### $ squeal status test/cli/main.test.ts
exit: 2; stdout lines: 0; stderr lines: 79
squeal status: takes paths only with --wait <ms>
### $ squeal status test/cli/main.test.ts test/cli/remove.test.ts
exit: 2; stdout lines: 0; stderr lines: 79
### $ squeal status --json test/cli/main.test.ts
exit: 2; stdout lines: 0; stderr lines: 79
```

**E2, `--wait 1`, two paths (one path is the same with one file).** Abridged; lines 1–35 of stdout precede the selection:

```text
exit: 3; stdout lines: 40; stderr lines: 0
Revision: 837 · 71e23f77 + 0, dirty not known
Affected checks: 0 passed, 0 running, 0 queued, 4400 unknown (3932 tests, 468 test files loaded)
...
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without a result: 468 (nothing current at their inputs, none queued)
  test/cli/codex-hash.test.ts: no result: no dependencies are installed in this worktree
  ... (20 listed, the two selected among them)
  and 448 more test files
...
Selected: test/cli/main.test.ts, test/cli/remove.test.ts
Unknown (2): test/cli/main.test.ts: no result: ...; test/cli/remove.test.ts: no result: ...
Named test files have no verdict: no daemon has validated since 2026-10-19T16:41:13.416Z: the daemon stopped; results are as of revision 837; `squeal start` starts one. Worktree: known failures 0; checks 0 running, 0 queued
```

The issue's "inherited provenance" appears here as the `Inherited from other worktrees` line; with no inherited results it is one line, not a list. The issue's worktree had inherited results; that variant was not reproduced.

## Source evidence

**S1, refusal.** `src/cli/main.ts:201–203`: when `--wait` is absent and any positional remains, `usage("status", "takes paths only with --wait <ms>")`, exit 2. `test/cli/status-wait-paths.test.ts:285` ("refuses paths without --wait") asserts exit 2 and that message. 011 C6 names a path form only for the wait; 005 D2 amends 001 D7 with `squeal status --wait <ms> <path>...` and no pathed snapshot. `--wait` takes any whole number (`src/cli/wait-arg.ts:14`, `^\d+$`), so `--wait 0` parses; its output was not run.

**S2, ordering.** `src/cli/status-wait-lines.ts:258–266` (`namedText`) returns `formatStatus(wait.result, …)` (the full worktree snapshot), then the selected line, the selection's failures, class lines and the verdict line. `src/cli/status-wait-paths.ts:338–370` sends the snapshot to stdout and, with `--json`, the named lines to stderr. 005 D2: "It prints the snapshot, then the files it selected, then the selected files' failures in full, and last their verdict … so a `tail` keeps the verdict (task 011-10, issue #26)". C6 says the same for the pathless wait. So E2 is specified behaviour; issue 26 chose verdict-last for `tail`, and nothing in C6 or D2 trims the snapshot for a selection.

**S3, other selected states.** `namedClassLines` (`status-wait-lines.ts:274`) prints a line per class only without a clean verdict: none for unmatched, none for a settled verdict whose code is not 3 (all passing, or failing, where the failures print through `namedFailures`). Pending reasons follow C15's list ("running since", "queued, promoted, behind…", "waiting for `<worktree>`'s run", slow, revision not listed). None of these was driven live here.

## Open questions

1. Should a scoped snapshot (`status <path>...`, no wait) print only the selection, or the selection after a trimmed worktree header? D2's verdict-last rule (issue 26) and the issue's "concise snapshot" both bear on it; the human decides, then C6/D2 are amended and the S1 test inverted.
2. Should the named wait's own snapshot drop the unrelated file list? Issue 42 asks only for the no-wait form; changing the wait's output touches issue 26's contract.
3. **Not determined, because not run:** live-daemon output for queued, promoted, running, claimed and passing selections, and for a worktree with inherited results. A fixture with installed dependencies and a live daemon would decide it; it was out of this brief's time and load budget.
4. **Not determined, because not run:** whether `--wait 0 <path>` already serves as a no-timeout snapshot (S1 shows it parses).

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/42 (read 2026-10-19, no comments).
- `src/cli/main.ts:193–216`, `src/cli/wait-arg.ts`, `src/cli/status-wait.ts:430–470`, `src/cli/status-wait-paths.ts:325–370`, `src/cli/status-wait-lines.ts:258–278`, `src/cli/status-sync.ts:43`, `test/cli/status-wait-paths.test.ts:285–290`, at `ccb2d700` (no diff from tag `squeal--v0.1.222` in `src/cli`, `src/core/status`).
- `docs/specifications/011-core/spec.md` C6, C15; `docs/specifications/005-agent-adoption/spec.md` D2; `docs/specifications/005-agent-adoption/status.md` (2026-10-17, 005-67/005-68).
- Probe: `research/probes/issue-42/probe.sh`, `README.md`, `output.txt`.
