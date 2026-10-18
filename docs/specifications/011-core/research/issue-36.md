# Issue 36: does a single unknown test file have a narrow rerun path?

Researcher, 2026-10-18, 20-minute time box, documentation only. Issue: hearsay-tools/squeal#36 (`gh issue view 36 -R hearsay-tools/squeal`). Specs read: 011 C4, C5, C6, C9, C15 and `status.md` at `8ec92f9b`.

Versions: installed Squeal **0.1.199** (`squeal --version`, plugin `squeal@hearsay`, git sha `e36fea56`, tag `squeal--v0.1.199`); `origin/main` = this worktree's HEAD `8ec92f9b`, **0.1.213** (`package.json`), run from its committed bundle `plugins/claude-code/dist/cli/squeal.mjs` without building. Vitest 4.1.10, symlinked read-only from `/home/agent/projects/cezar/node_modules`. The incident's version is 0.1.199 (issue text).

Host load: one-minute load 11.41 on 24 CPUs at the start (`/proc/loadavg`, `nproc`), 7.12 to 9.66 at each probe's start, 12.44 at the end. That is below the CPU count throughout, so the live probe ran.

## Verdict

**Reproduced: `squeal retry` refuses a file whose result is unknown, on 0.1.199 and on 0.1.213 alike, and its refusal names no other command (verified by experiment).** A narrow path does exist, though: `squeal run --all` without `--force` queues only the files that have no current result. In the probe it printed `3 test files, 2 already current, 1 run now` on both versions (verified by experiment). The issue says `run --all` "reruns the whole suite". That premise is wrong: the misreading is caused by the command's name and by the fact that its refusal and the 0.1.199 status never point at it. What the CLI lacks is a single-file request. `run --all` also takes every other file that has no result, and its `--wait` waits for all of them. Most of the 37 minutes came from other causes: the unknowns that 0.1.199 left unqueued (#10), the 300 s named wait that selected 81 files (#30), and a status that named no command (#24). The refusal itself took seconds (inferred from the issue's sequence).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Why does retry refuse an unknown file? | `askLine` accepts only a file with a stored `fail` known state. An unknown file has a key and no `fail`, so it gets `Not retried: <file> has no known failure in this worktree.` and exit 1. That happens with both reasons. | read in source code (`src/cli/retry.ts:139-163`); verified by experiment (0.1.199, 0.1.213) |
| 2 | Did retry change between 0.1.199 and 0.1.213? | No. `git diff --quiet squeal--v0.1.199 HEAD -- src/cli/retry.ts src/core/retry src/cli/run.ts` exits 0. | read in source code |
| 3 | Is there a narrow rerun path for one unknown file? | `run --all` queues only non-current files and clears their unknown mark (`queueFullSuite`: `classify(file) !== "current"`, `file.unknownKey = null`). Probe: `3 test files, 2 already current, 1 run now`, then `6 passed`. There is no single-file request. | read in source code (`src/core/scheduler/checkpoint-requests.ts:50-103`); verified by experiment (both) |
| 4 | Does a named wait re-queue an unknown file? | No. It exits 3 at once: `Named test files have no verdict: 1 test file without a current result at revision 1 (1 unknown)`. | verified by experiment (both) |
| 5 | Does status name the command that advances it? | On 0.1.213 it does: `Idle: nothing is running and no run is open; 1 test file without a result, none queued (\`squeal run --all --wait\` runs every test file without a result and waits)` (011-12, `b4eca021`, 0.1.210). On 0.1.199 there is no such line. | verified by experiment |
| 6 | Does 011-06 (#10) remove the unknown state? | Only for a transient touch. When touches repeat, both versions end unknown and unqueued after two runs in a row: the 007-30 barrier says `stays unknown until an input changes`. With one touch, 0.1.199 already ran the tier once more. | verified by experiment (both) |
| 7 | Was the 37-minute incident reproduced? | No. No cezarion run, no 81-file backlog, no timing. The incident's reason text was reproduced exactly on 0.1.199: `vitest adapter: dist/lib.js was written during this run and ended as it was; ... (task 001-159)`. | verified by experiment (reason text); inferred (timeline) |

## Exact commands and output

`probes/issue-36/probe.sh <cli> 5 <node_modules> edit` builds the repo, runs a clean baseline, appends `// edit` to `tests/a.test.ts`, and lets that file rewrite `dist/lib.js` with the same bytes in each run. The full outputs are in `probes/issue-36/output-*.txt`. From the 0.1.213 run (0.1.199 prints the same lines apart from the `Idle:` line, the reason's word order and the verdict line's suffix):

```
$ squeal status --wait 60000
Idle: nothing is running and no run is open; 1 test file without a result, none queued (`squeal run --all --wait` runs every test file without a result and waits)
Test files without a result: 1 (nothing current at their inputs, none queued)
  tests/a.test.ts: no result: vitest: vitest adapter: the run may have executed bytes no check key names, since dist/lib.js was written during this run and ended as it was (task 001-159)
$ squeal retry tests/a.test.ts --reason environment
Not retried: tests/a.test.ts has no known failure in this worktree.
(exit 1)
$ squeal retry tests/a.test.ts --reason load
Not retried: tests/a.test.ts has no known failure in this worktree.
(exit 1)
$ squeal status --wait 20000 tests/a.test.ts
Named test files have no verdict: 1 test file without a current result at revision 1 (1 unknown). Worktree: known failures 0; checks 0 running, 0 queued
(exit 3)
$ squeal run --all --wait
Checkpoint 8d1f0d7a-... completed at revision 1: no known failures; 3 test files, 2 already current, 1 run now
(run --all --wait exit 0)
```

## Three things the issue runs together

- **Retry refusal (this issue).** It is reproduced. It is correct under C5, where a retry re-runs a counted FAIL once per key per session and an unknown file has no FAIL. Its gap is wording: nothing names the command that does advance an unknown file.
- **The 37-minute incident.** The issue gives this sequence. The unknowns came from #33. 0.1.199 left adapter-withheld files unknown and unqueued, which is #10, done in 0.1.205 as 011-06. Two waits returned with nothing running, and 0.1.199's status named no command (#24, done in 0.1.210 as 011-12). The named wait selected 81 files and ran its full 300.4 s, which is #30, a duplicate of #6 fixed in 0.1.204 as 005-67. The agent's own `npm test -- <files>` matches the skill's step 5 ("run tests yourself only when ... a result is unknown"). The refusals were one step of this. Timing not reproduced.
- **`run --all`.** It skips current files, so in the incident it would have queued the 8 unknown files plus whatever else had no result. The 81 files were pending already. Its `--wait` would have waited for all of them, not for the 8 (inferred from C4 and `queueFullSuite`; not run at that scale).

## Related issues, not exact duplicates

None of these is an exact duplicate. #10 (011-06) re-queues a withheld run but leaves the repeated-touch end state unknown and unqueued (Q6). #24 (011-12) names `squeal run --all --wait` in status on 0.1.213, which half covers the issue's second option, but in status and not in retry's refusal. #33 is the cause of the unknowns, a separate question. #30 is the named-wait selection, already a duplicate of #6. Also near: gh-34 (pending failures counted as known), 001-383 (an exhausted withhold whatever the run's end).

## Recommendation for Squeal

Keep retry's C5 meaning. An unknown file is already "always work to do" under C4, so it needs no retry, a spent session retry or a reason. Change the refusal for a keyed file that has no current result: name its state and the command that advances it, for example `Not retried: tests/a.test.ts has no result at its inputs (unknown: <reason>); squeal run --all queues every file without one, and squeal status --wait 60000 tests/a.test.ts waits for this one.` That fits C6's wording rule and 011-12's line. A single-file request (`run <file>`, or retry accepting unknown files) costs a new C-section and is a human decision. It would only buy a narrower `--wait`. After `run --all`, a named wait on the file should already promote it under C15 (inferred, not probed).

## Open questions

- Did the incident's files end unknown through the adapter path alone (001-159, unqueued in 0.1.199) or through the 007-30 barrier? In the probe one touch was healed by the barrier. Not determined, because the issue quotes the reason truncated with `…`.
- Should a named wait on an unknown, unqueued file name `run --all` on its verdict line too? On 0.1.213 it is named only in the `Idle:` line above the verdict.
- The primer's retry sentence (`src/harness/shared/primer.ts:126`) offers retry only for failures. Whether it should mention unknown files is a C8 wording question, not probed.

## Limitations

One host, one synthetic repo of three files, one Vitest project, touches made by the test itself. 0.1.213 was run from its committed bundle, not from an installed plugin. No cezarion run, no backlog, no timing of the incident. No suite, build or gate ran (docs-only brief).

## Sources

- hearsay-tools/squeal#36, `gh issue view 36 -R hearsay-tools/squeal --json title,body,comments`.
- `docs/specifications/011-core/spec.md` C4 (unknown, `run --all`, stability, MAX_DISCARDS), C5 (retry), C6, C15; `status.md` lines for 011-06, 011-12, 011-13.
- `src/cli/retry.ts`, `src/core/scheduler/checkpoint-requests.ts`, `src/core/scheduler/stability.ts:156-157`, `src/runners/vitest/moved.ts:81-123`, `src/core/scheduler/ledger.ts:44`, `src/core/status/work-line.ts`, `src/harness/shared/primer.ts:126`; commits `aa260ef0` (011-06), `b4eca021` (011-12).
- `plugins/claude-code/skills/squeal/SKILL.md` step 5, `references/commands.md` "squeal run --all".
- `docs/board.md` rows 011-06, 011-12, 005-67, gh-30, gh-33, gh-34.
- Probe: `probes/issue-36/` (`README.md`, `probe.sh`, `output-*.txt`).
