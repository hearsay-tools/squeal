# Issue 143: a Vitest start parses a conflicted config during the merge hold

Researcher findings for hearsay-tools/squeal#143, 2026-11-03. Live probes ran the Claude Code bundle 0.1.390 (`~/.claude/plugins/cache/hearsay/squeal/0.1.390/dist`, `--version` 0.1.390), the version the issue names. Source read at `8ce4f23fc` (`package.json` 0.1.393); `git log f91a22e59..HEAD` (0.1.390 release commit to HEAD) lists no commit under `src/core/scheduler`, `src/core/state`, `src/core/daemon-loop` or `src/runners/vitest`, so the read code is the code that ran. The installed CLI is 0.1.392; it was not run. Vitest 5.0.3, Node 24.22.1, git 2.43.0. Host: 24 CPUs; one-minute load 5.37 before the work, 3.59 at run A, 7.14 at run B, all below the CPU count. Reproduction only. Nothing is designed. Existing holds stand.

**Verdict.** Partly reproduced. During the merge hold, 0.1.390 reloads Vitest for the changed `vitest.config.ts`, Vitest parses the conflicted bytes and fails (`[PARSE_ERROR] Encountered diff marker`), and every test file becomes UNKNOWN at the conflict's revision. The hook delivers the 4 UNKNOWN checks beside the hold line. This is runner startup (the revision's runner part: `invalidate`, `environment`, `testFiles`, `affected`), not a tier: no test runs and no result is stored. The second half, UNKNOWN that persists after resolution, did not reproduce: the write of the resolved config reloads Vitest successfully, the files go to queued, and `git add` ends the hold and runs them to PASS. 0.1.390 matches the written contract: C9 holds tiers, not the runner part, and C4 makes a failed invalidation UNKNOWN at its revision. The issue's expected behaviour is a contract change, not a defect against today's text.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Does a Vitest start parse an unmerged `vitest.config.ts` during the hold? | Yes. At revision 1, held, the note reads `runner invalidate (vitest.config.ts) failed: Build failed with 1 error: [PARSE_ERROR] Encountered diff marker ... vitest.config.ts:4:1`, then `environment failed` with the same error. | verified by experiment (0.1.390) |
| 2 | Is that a scheduled tier, or runner startup and discovery? | Runner startup and discovery. `src/core/scheduler/refinement.ts:116-136` calls `invalidate`, then `environment` when a project was recreated, then `testFiles`, with no hold check. C9's hold covers tiers only. `why a.test.ts` after resolution lists no result at revision 1. | verified by experiment; read in source code |
| 3 | What do status and the hook show while held? | `status`: the hold line and `4 unknown`, `Outstanding: 2 test files without a result, runner invalidate (vitest.config.ts) failed`. Hook at revision 1: `SQUEAL · 4 checks changed ... at revision 1 ... 4 unknown`, then the hold line, then `UNKNOWN 4 checks`. | verified by experiment |
| 4 | Does an edit during the hold call the runner again? | Yes. Editing `b.test.ts` at revision 2 called `invalidate (b.test.ts)`, which failed again on the still-conflicted config; both files stayed UNKNOWN. | verified by experiment |
| 5 | Does the UNKNOWN persist after resolution? | No, in both runs. Run A: writing the resolved config (revision 3, `git ls-files -u` still 3 stages) reloaded Vitest: `4 queued`, `on hold for the unresolved merge`. `git add` ended the hold at revision 3 without a new revision: `5 passed`, hook `validating again at revision 3 ... no check pending, stale or unknown`. Run B (no hook between conflict and resolution): the first hook after `git rebase --continue` said `no check pending, stale or unknown`; the UNKNOWN was never delivered. `why` keeps `revision 1 PASS -> UNKNOWN` in history in both runs. | verified by experiment |
| 6 | Is a result from a run that started on a held revision stored or reported later? | Not observed: no run started on a held revision. The only results are revision 0 (baseline) and revision 3 or 2 (after the hold). | verified by experiment |
| 7 | Already-running work: a tier in flight when the conflict lands | Not determined, because the fixture had no tier in flight at the conflict. C9: "A tier in flight when the hold begins runs to its end"; its key-level hold covers keys that name an unmerged path, and the hook at revision 2 of run B said `No result for vitest.config.ts: no test Squeal runs reads it`, so the config is in no closure and that key-level hold would not cover it. Whether a running Vitest instance reads the new config mid-run was not probed. | read in official docs (spec C9); inferred |
| 8 | What reproduces the issue's "628 files UNKNOWN at revision 9, after resolution"? | Not determined, because the fixture's resolution always reloaded Vitest successfully, and the reporter's store was not available. The reporter's `squeal why <file>` history (transitions after revision 5) would decide between a late delivery of the revision-5 transition and a state that stayed UNKNOWN. | not determined |

## Experiments

Recipe: `probes/issue-143/README.md`, `run.sh` (run A) and `run-quiet.sh` (run B). Scratch trees `/tmp/issue143-probe` and `/tmp/issue143-quiet`, each with its own `HOME` and `XDG_RUNTIME_DIR`. Output is not committed; the lines above are quoted from it. Both daemons were stopped with `squeal stop`; the scratch trees were deleted.

Fixture: branch `side` sets `testTimeout: 6000`, `main` sets `7000`; on `side`, `git rebase main` conflicts in `vitest.config.ts` only. Commands of run A, in order:

```
bash run.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.390/dist
  hook session-start.mjs; squeal start; squeal run --all --wait; hook post-tool-batch.mjs   # 4 passed
  git rebase main                       # exit 1, CONFLICT in vitest.config.ts; ls-files -u: 3 stages
  squeal status; status --json; status --full; hook post-tool-batch.mjs; squeal why a.test.ts
  edit b.test.ts (adds test b2); squeal status
  write resolved vitest.config.ts (7000); git ls-files -u (3 stages); squeal status; hook
  git add vitest.config.ts b.test.ts; squeal status --wait 60000; hook; squeal why a.test.ts
  git rebase --continue; squeal status --wait 60000; status --full; hook; why a.test.ts; why b.test.ts
  edit helper.ts; squeal status --wait 60000; hook; squeal stop
```

Run B does the baseline, `git rebase main`, waits 3 s, then writes the resolved config, `git add`, `git rebase --continue` in one step, waits 3 s, and only then calls the hook, `status --wait 60000` and `why a.test.ts`.

A first attempt of run A ran without Vitest installed (an npm `ETARGET` under `--prefer-offline`). Its notes already show the runner part called during the hold at revisions 1, 2 and 3 (`runner invalidate (vitest.config.ts) failed: vitest could not start: vitest/node does not resolve`). The scripts now pin `vitest@5.0.3` and stop on a failed install.

## Contract read (spec 011, `status.md`, spec 013)

- C9 *Holds*: "While either holds, no tier starts in any lane of the worktree ... The daemon goes on recording revisions, keying, looking up and queueing". It names no rule for the runner part.
- C9 *Unresolved merge*: "A tier in flight when the hold begins runs to its end." A key that names an unmerged path "through its closure or its project's environment inputs" takes no stored result.
- C4 (line 142): "when environment, invalidation or closure resolution fails for a project, every test file of that project becomes `unknown` at this revision with the runner's message as the reason, one factual line is delivered, and a note is persisted".
- 013 (line 60): the runner part (`invalidate` without a recreate, `affected`, `closure`, `enumerate`, `testFiles`, `environment`) is its own queue beside runs.
- `status.md` 2026-10-21, 011-61: the hold design; 011-72 and 011-128 add the store-side checks. None places the runner part under the hold.

## For the spec (inputs, not a design)

- The issue's first expectation ("no Vitest run should start") is met for runs. What happens is a Vitest *start*: an instance recreate inside the runner part. Holding it would be a C9 amendment.
- Holding the runner part has a cost the spec must weigh: listing, closures and the environment are what keying and queueing use while held, and C9 says those go on. A held runner part leaves the queue built from the last good listing.
- The second expectation ("no result from such a run stored or reported after the hold ends") holds in the fixture: nothing was stored, and nothing stale was reported after resolution.
- Rebase was probed; merge, cherry-pick and `stash pop` were not. Conflicts in a config imported by the config, and a config conflict whose bytes still parse, were not probed.

## Open questions

- The issue's revision-9 UNKNOWN (question 8). Needs the reporter's `why` history or a probe at a larger scale, with several rebase steps and a slow tier in flight.
- Codex's `post-tool-use.mjs` was not run; C8 says every adapter maps onto one contract.
- 0.1.392 and 0.1.393 were not run live; the source paths are unchanged since 0.1.390.

## Sources

- hearsay-tools/squeal#143 (`gh issue view 143 --comments`, read 2026-11-03; the bot comment links #68).
- `docs/specifications/011-core/spec.md` C2, C4 (line 142), C9 *Holds*; `status.md` entries for 011-61, 011-72, 011-73, 011-128; `docs/specifications/013-vitest-runner/spec.md` lines 23, 60, 64.
- `src/core/scheduler/refinement.ts:95-136` at `8ce4f23fc`.
- `research/issue-68.md` and `probes/issue-68/` (the prior reproduction this probe follows).
- `probes/issue-143/` (throwaway recipe and fixture).
