# Issue 68: test runs during an unresolved git merge

Researcher findings for hearsay-tools/squeal#68, 2026-10-21. Squeal 0.1.235 source (`package.json`), branch `cez/b2299644` at `2a5252387`; the probe ran the committed Claude Code bundle `plugins/claude-code/dist` (`cli/squeal.mjs` byte-identical to the installed Codex 0.1.235 CLI, `--version` 0.1.235). Vitest 5.0.5, Node 24.21.0, git 2.43.0. Host: 24 CPUs, 1-minute load 2.77 at start, 2.15 and 1.90 before the two probe runs, below the CPU count, so the probe ran. Reproduction only. Nothing is designed or implemented. The existing holds stand.

**Verdict.** Reproduced. While `git ls-files -u` lists a path, Squeal 0.1.235 records a revision for the conflicted file, runs the test files that import it, and stores and delivers `Transform failed with 1 error:` failures. `status` and the hook say nothing about the merge. The first revision after resolution runs the same files again and reports FAIL -> PASS. One fact bears on the issue's proposed rule: that revision is the write of the resolved bytes, while `git ls-files -u` still lists the path. `git add` and `git commit` create no revision.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a conflicted merge create a revision and start affected runs? | Yes. Revision 1, `dirty`. `a.test.ts` and `b.test.ts` (importers of `helper.ts`) ran; `other.test.ts` did not. | verified by experiment (0.1.235) |
| 2 | Do the runs record and print transform failures? | Yes. 4 checks PASS -> FAIL (2 file-level, 2 tests), summary `Transform failed with 1 error:`; `why` shows Vite's `[PARSE_ERROR] Encountered diff marker` at `helper.ts:2:1`. `status` lists all 4; the PostToolBatch hook delivers all 4. | verified by experiment |
| 3 | Do `status` or the hook name the unresolved merge? | No. Nothing about the merge, the unmerged path or `MERGE_HEAD` in `status`, `status --full`, the hook or `why`. | verified by experiment; read in source code |
| 4 | Does resolution resume checks? | Yes, at the first revision after it: 4 checks FAIL -> PASS, `Known failures: 0`. | verified by experiment |
| 5 | Which step of a resolution creates that revision? | The write of the resolved file (revision 2, `+ 2, dirty`), with `git ls-files -u` still listing 3 stages. `git add` left revision 2 (`ls-files -u` then empty). `git commit` left revision 2 and moved the display to `+ 0`. | verified by experiment |
| 6 | Does any 0.1.235 code read the merge state? | No. The only "unmerged" in `src/` is a comment in `src/core/hash/git-index.ts:40` (an unmerged file is hashed from bytes, not the index). | read in source code |
| 7 | Load cost and context size at the reported scale (353 checks, load 40-55) | Not determined, because the brief requires a tiny fixture. The fixture shows the per-check shape only. | not determined |

## Experiments

Recipe: `probes/issue-68/README.md` and `run.sh`. Scratch tree `/tmp/issue68-probe` with its own `HOME` and `XDG_RUNTIME_DIR`. Generated output is not committed; the lines below are quoted from it.

Commands, in order (run 2, which splits step 3; run 1 did write, `git add` and commit at once and gave the same steps 1 and 2):

```
hook session-start.mjs; squeal start; squeal run --all --wait; hook post-tool-batch.mjs
git merge side            # exit 1, "CONFLICT (content): Merge conflict in helper.ts"
git ls-files -u           # 3 entries, stages 1, 2, 3 of helper.ts
squeal status --wait 60000; squeal status --full; hook post-tool-batch.mjs; squeal why a.test.ts
write resolved helper.ts; git ls-files -u; squeal status --wait 60000; hook post-tool-batch.mjs
git add helper.ts; git ls-files -u; squeal status --wait 60000
git commit --no-edit; squeal status --wait 60000; squeal status --full; hook post-tool-batch.mjs
squeal stop
```

Measured:

- Baseline: `Known failures: 0; all 3 test files current`, `6 passed (3 tests, 3 test files loaded)`.
- After the merge, 2 s later: `Revision: 1 · 3213a9e7 + 1, dirty`, `Known failures: 4 (2 tests, 2 test files that did not load); all 3 test files current`, each `FAIL ... Transform failed with 1 error:`, `load 0.09 per CPU when it ran`. `why a.test.ts` shows its failing run at 4 ms.
- Hook at revision 1: `SQUEAL · 4 checks changed (2 tests, 2 test files loaded) at revision 1`, then 4 blocks `PASS -> FAIL, seen by Squeal's run at revision 1 / Transform failed with 1 error: / its closure reads files changed here since this session started: helper.ts`.
- Resolved bytes written, `ls-files -u` still 3 entries: `Revision: 2 · 3213a9e7 + 2, dirty`, `Known failures: 0`. Hook: `4 checks changed ... at revision 2`, 4 blocks `FAIL -> PASS`.
- After `git add`: `ls-files -u` empty, still `Revision: 2 · 3213a9e7 + 2, dirty`.
- After `git commit`: `Revision: 2 · f9853041 + 0`, `clean at revision 2`; the hook printed nothing.
- `squeal stop`: `Squeal daemon stopped for /tmp/issue68-probe/r`. No process matched `issue68-probe` afterwards; the scratch tree and output were deleted.

## Source evidence

- Spec 011 C2: a revision is created only when a reported path's git blob hash changes; `.git` is excluded at watch time. `src/core/watcher/paths.ts` `isGitMetadata` treats every `.git` segment as "a repository's metadata, never an input". So the index writes of `git add` and `git commit` reach no batch. This explains finding 5.
- Spec 011 C2 (amended 2026-10-15, task 001-406): a commit leaves the revision number unchanged; a `HEAD` move changes only the `+ K` and dirty display (`src/core/daemon-loop/head.ts` `readHead`, `src/core/scheduler/head-move.ts`). This matches `+ 2, dirty` -> `+ 0`.
- `src/core/hash/git-index.ts:32-45`: an unmerged path is listed by `git status`, so its hash comes from the bytes on disk. The conflicted bytes therefore get a new key, and the runs follow (C3, C4).
- No 0.1.235 file reads `git ls-files -u`, `MERGE_HEAD` or `REBASE_HEAD` (`grep -rn -i 'unmerged\|ls-files -u\|MERGE_HEAD\|REBASE_HEAD' src`).

## For the spec (inputs, not a design)

- A hold keyed on `git ls-files -u` alone meets an ordering problem: the resolved write is the revision that would resume runs, but at that revision the path is still unmerged. The later `git add` produces no revision, so under that rule runs would not resume until another edit. The spec must name what ends the hold: an index observation that triggers a re-plan of the held revision, conflict markers in the path's bytes, or both. Inferred from findings 5 and the C2 rule above.
- The issue's acceptance criterion 2 ("the first revision after the merge is resolved runs the affected checks") holds today, because there is no hold. Criterion 1 (no runs, one line naming the paths) does not hold.
- Rebase, cherry-pick and `stash pop` conflicts also leave unmerged entries; only `git merge` was probed.

## Open questions

- The cost at the reported scale (353 checks, 2 batches of about 20 entries plus "Not shown") was not measured; the fixture had 4 checks.
- Whether other harness hooks (Codex `post-tool-use.mjs`) print the same lines was not probed; C8 says every adapter maps onto one contract.
- Conflicts in a non-code input (JSON, a config file) and conflicts that still parse (markers inside a string or a comment) were not probed.

## Sources

- hearsay-tools/squeal#68 (`gh issue view 68`, read 2026-10-21).
- `docs/specifications/011-core/spec.md` C2, C4, C6, C8; `status.md`.
- `src/core/hash/git-index.ts`, `src/core/watcher/paths.ts`, `src/core/daemon-loop/head.ts`, `src/core/scheduler/head-move.ts` at `2a5252387`.
- `probes/issue-68/` (throwaway recipe and fixture).
