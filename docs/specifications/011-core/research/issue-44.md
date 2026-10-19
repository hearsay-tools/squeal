# Issue 44: a named wait leads with the whole worktree

Recommendation: treat [issue 44](https://github.com/hearsay-tools/squeal/issues/44) as the third decision gh-42 already asks for ("whether named-wait output also changes"), not as a defect: 0.1.223 prints the whole-worktree snapshot before `Selected:` exactly as 011 C6 and 005 D2 specify, and the verdict stays the last line as 011-10 requires.

## Scope and verdict

**Reproduced in its core shape, synthetic fixture.** On shipped 0.1.223 a named wait on one edited test file printed 36 lines of whole-worktree status, including 20 per-file `no result: never run at this key: the baseline is lookup-only, so nothing queued it` lines about files it did not name and `and 4 more test files`, before `Selected:` (line 38 of 39) and the verdict (line 39). The issue's scale (about 18,000 checks, an `Inherited from other worktrees:` breakdown, 42 listed files) and its Vitest-plus-inherited-baseline setup were **not reproduced**.

Examined 2026-10-19, Squeal **0.1.223**: installed plugin bundle `~/.claude/plugins/cache/hearsay/squeal/0.1.223/dist/cli/squeal.mjs` (`--version` 0.1.223; `squeal --version` on the PATH also 0.1.223). Node v24.21.0. Source read at this worktree's `2ee1e3bf`; tag `squeal--v0.1.223` is `ac19ab38`, and `git diff --stat squeal--v0.1.222 squeal--v0.1.223 -- src/cli src/core/status` and `git diff --stat squeal--v0.1.223 HEAD -- src/cli src/core/status` are both empty, so the source read is the shipped source, and gh-42's 0.1.222 reading of the same seam still applies.

**Host load.** Before work: `uptime` gave 3.70 / 5.54 / 7.57 on `nproc` 24, below the CPU count. Immediately before the live probe `/proc/loadavg` read **24.57** / 13.70 / 10.35, above 24; the probe had been launched in the same command and ran anyway (one daemon, one node:test file of about 0.5 s). That breaks the brief's skip rule; it is recorded here, not hidden. The output shape it shows is the print order, which load does not change (S1); no timing claim is drawn from it. After: 24.30. No second run was made. The coordinator subsequently added a pre-start load guard to the saved probe; that revised script was syntax-checked, not run.

No build, test suite, product, spec, status, skill or board change. Existing holds stand.

## Questions answered

| Question | Answer |
| --- | --- |
| 1. Does a named `status --wait` print unrelated whole-worktree sections before `Selected:` on 0.1.223? | **Yes, verified by experiment (E1)** on a synthetic fixture: 36 snapshot lines (counts, idle line, daemon, inheritance, 24 files without a result with 20 listed, closure method, store schema, notes), a blank line, then `Selected:` and the verdict. **Read in source code (S1):** unconditional; `namedText` prepends `formatStatus` of the whole snapshot. |
| 2. Is the verdict last, as 011-10 requires? | **Yes, verified by experiment (E1).** The verdict is line 39 of 39 in text; with `--json` stdout is the snapshot plus `wait` (305 lines) and stderr is only `Selected:` and the verdict (2 lines). |
| 3. Is this the specified behaviour? | **Yes, read in source code and spec.** 005 D2: "It prints the snapshot, then the files it selected, then the selected files' failures in full, and last their verdict ... so a `tail` keeps the verdict (task 011-10, issue #26)". 011 C6: "It prints the snapshot first and its own line last". |
| 4. Can a tail lose the verdict, as the issue says? | **No, inferred from E1 and S1:** the verdict is always the last line, so any `tail` keeps it. A short tail can lose the `Selected:` line and the selected failures and class lines above the verdict when the snapshot is long; the issue's "show only the listing" fits a `head`, not a `tail`. Not determined which the reporter ran, because the issue shows no command. |
| 5. The inherited breakdown and the scale in the issue? | **Not reproduced.** The fixture has one worktree, so inheritance reads `none`. That a long inherited breakdown prints in a named wait is **inferred** from S1 (same `formatStatus` call). |

## Experiments

From this worktree root:

```sh
docs/specifications/011-core/research/probes/issue-44/probe.sh \
  ~/.claude/plugins/cache/hearsay/squeal/0.1.223/dist/cli/squeal.mjs \
  > docs/specifications/011-core/research/probes/issue-44/output.txt 2>&1
```

Fixture: a fresh git repo, `squeal.config.json` `{"baseline":{"onStart":"lookup-only"},"nodeTest":[{"name":"unit","cwd":".",...,"include":["test/*.test.mjs"]}]}`, 25 passing node:test files, private `HOME`, `XDG_*` and `XDG_RUNTIME_DIR` in the temp dir. Steps: `squeal start`, `squeal status --wait 60000` (discovery), append a test to `test/f01.test.mjs`, `squeal status --wait 60000 test/f01.test.mjs`, the same with `--json`, `squeal stop`. Full output: `probes/issue-44/output.txt`.

**E1** (abridged):

```text
exit: 0; stdout lines: 39; stderr lines: 0
first line starting Selected: 38
Revision: 1 · 64cf3a8f + 1, dirty
Known failures: 0
Affected checks: 3 passed (2 tests, 1 test file loaded), 0 running, 0 queued
Idle: nothing is running and no run is open; 24 test files without a result, none queued (...)
...
Inherited from other worktrees: none (every current result here was run in this worktree)
Test files without a result: 24 (nothing current at their inputs, none queued)
  unit: test/f02.test.mjs: no result: never run at this key: the baseline is lookup-only, so nothing queued it
  ... (20 listed)
  and 4 more test files
Closure method: static imports plus declared inputs
Store schema: 1
Notes:
  ... node-test project "unit": 1 test file(s) loaded nothing beyond themselves ...

Selected: test/f01.test.mjs
Named test files at revision 1: no known failures; 1 test file, each with a current result, after 0.5 s. Worktree: known failures 0; checks 0 running, 0 queued
```

## Source (read in source code, at 2ee1e3bf = shipped 0.1.223 for these paths)

- **S1.** `src/cli/status-wait-lines.ts:258-266` `namedText`: `` `${formatStatus(wait.result, now, command)}\n${lines.join("\n")}\n` `` with `lines` = `selectedLine`, `namedFailures`, `namedClassLines`, `namedLine`. `wait.result` is the whole worktree's snapshot (`buildSnapshot(store, root, ...)`, `src/cli/status-wait-paths.ts:288`). Nothing scopes or drops a section for a named wait.
- **S2.** `src/cli/status-wait-paths.ts:338-370` `namedWaitCommand`: text goes through `namedText`; `--json` writes the snapshot plus `wait` to stdout and the selected and verdict lines to stderr.
- **S3.** `src/core/status/unknown-files.ts:106-108,123-130`: the `lookup-only` reason and the `Test files without a result` listing (20 shown, then `and N more`) are worktree-wide; `src/core/status/format-status.ts:153-154` prints the inheritance line the same way.

## Interaction with 011-10 and gh-42

- **011-10 (done, 0.1.208)** fixed the verdict as the **last** line so a `tail` keeps it, and pinned the settled, timed-out and named cases to end with it. The issue's suggested fix, "lead with the named files' verdict", taken literally moves the verdict to the top and breaks that contract and its tests. Two shapes keep both: (a) a named wait prints only the selection lines and the verdict, or a short header, with the worktree sections dropped or behind a flag, verdict still last; (b) the verdict printed first and repeated last. Either is a C6 and 005 D2 amendment; neither is decided here.
- **gh-42 (proposed, human decision pending)** reproduced the same order on 0.1.222 with `--wait 1` and no daemon (`research/issue-42.md` E2) and asks the human, among others, "whether named-wait output also changes". Issue 44 is that question with a live daemon and an edited file. **Inferred:** overlapping in part, not an exact duplicate (gh-42's main ask is a snapshot without `--wait`); the two would be decided together.

## Open questions

- Whether the reporter's cut-off came from `head` or a short `tail` (Q4).
- Whether the inherited breakdown at the issue's scale adds lines a fixture of one worktree cannot show (Q5); a two-worktree fixture with an installed Vitest would settle it.
- The decision itself: drop, scope or flag the worktree sections in a named wait, and whether the agent primer and skills that teach `| tail` change with it. The human's.

## Sources

- Issue: https://github.com/hearsay-tools/squeal/issues/44 (read with `gh issue view 44 -R hearsay-tools/squeal`, 2026-10-19).
- `docs/specifications/011-core/spec.md` C6, C15; `docs/specifications/005-agent-adoption/spec.md` D2; `docs/board.md` rows 011-10 and gh-42; `research/issue-42.md`, `research/issue-26.md`.
- `src/cli/status-wait-lines.ts`, `src/cli/status-wait-paths.ts`, `src/core/status/unknown-files.ts`, `src/core/status/format-status.ts` at 2ee1e3bf.
- Probe: `research/probes/issue-44/probe.sh`, `output.txt`.

## Human direction, 2026-10-19

The human requested shorter, better organized status output in general, beyond named waits, and notes optional behind a flag. They find the remaining report hard to read and believe it may confuse agents too. This is direct user feedback, not an experimental finding about agent comprehension. The board records that direction on gh-44 alongside its overlap with gh-42. A proposed layout leads with the requested verdict, outstanding work and actionable failures while preserving provenance and uncertainty. The exact layout and how it retains 011-10's final verdict need design work within the owning spec; this documentation-only triage changes no contract and authorizes no implementation dispatch. Existing holds stand.
