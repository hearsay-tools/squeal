# Issue 66: origin of an inherited result, and setup-file edits

Triage reproduction only (researcher, 2026-10-21). Sources: gh issue 66; 011 spec C3, C5, C6, C7 and 013 V3, V5, V6 with their status logs at `18aff2857`; source at `18aff2857` (0.1.234); the installed CLIs 0.1.234 and 0.1.233 (`~/.claude/plugins/cache/hearsay/squeal/<v>/dist`). Probes: `probes/issue-66/` (throwaway).

Host: 24 CPUs. One-minute load was checked before each live probe and was below 24 each time (19.55 to 23.82 at each start, 9.78 to 24.17 at each end; each output file records both). Two checks found it above (24.83, 25.30); the probe waited until it fell.

## Answers

| # | Question | Verdict | Tag |
|---|---|---|---|
| Q1 | Do inherited-result change notices and status omit the origin worktree and commit? | **Reproduced.** The UNKNOWN notice and `squeal status` name no origin. The `FAIL` and recovery notices do name one. Also found: the origin that `why` shows for a timed-out check can be wrong. The timeout was this worktree's own run, but `why` names the worktree that the previous result came from. | verified by experiment (0.1.233, 0.1.234); read in source code |
| Q2 | Can an inherited result from before the edit still apply after a Vitest `setupFiles` entry is edited? | **Not reproduced.** The edit re-keys every test file of the project, and no inherited result from before the edit applies after it. | verified by experiment (0.1.233, 0.1.234); read in source code |
| — | The original incident (cezarion worktree, 671-test file, 0.1.233) | **Not re-run**, as the brief requires. The synthetic probe `run-own.sh` gives the same notice text and the same `why` lines. This makes one explanation likely: the 600 s timeout came from the reporter's own worktree, not from another one. | inferred |

## Q1: origin in notices and status

**Notice.** `src/core/delivery/format.ts` `unknownBlocks` (read in source code, 0.1.234) builds an UNKNOWN block from four lines: the counts, the reason, the files and the `Full reason` pointer. It has no origin line. `entryBlock` adds `seenLine` to a FAIL (`seen by Squeal's run in <worktree> at commit <sha>`) and `recoveryProvenance` to a recovery (`inherited from …`). So the notice names an origin for FAIL and PASS, but never for UNKNOWN.

**Status.** `squeal status` prints no origin for any check. `status --full` (`status-detail.ts`) prints `N from <worktree> at <commit>` only for current inherited results (`snapshot.ts:247` skips any state that is not `current`). For an unknown file it prints only the reason: `slow.test.ts: no result: timed out after 2 s`. Only `squeal why` prints `Origin:` for each check (`format-why.ts:179`). The 011 C5 spec text asks for origin facts only for known failures (the "Recorded in …" line at registration). It asks for none on UNKNOWN blocks.

**Experiment** (`run-own.sh`, outputs `run-own-output-0.1.234.txt` and `run-own-output-0.1.233.txt`). Worktree A passes both files. Worktree B inherits them (`Origin: inherited from …/a at bebd77c`). B then edits `setup.ts` so that `slow.test.ts` sleeps past the 2 s tier timeout, and B's own run times out. B's PostToolBatch notice, identical on both versions:

```
UNKNOWN  2 checks (1 test, 1 test file loaded) in 1 test file
      PASS -> UNKNOWN (1 test, 1 test file loaded)
      timed out after 2 s
      slow.test.ts
      Full reason: squeal why "slow.test.ts (file-level)"
```

This is the issue's notice, at a smaller size. B's `squeal why slow.test.ts`:

```
Known state: UNKNOWN, unknown, observed at revision 1, commit bebd77c
  Origin: inherited from /tmp/issue66-own-0.1.234/a at bebd77c
  Summary: timed out after 2 s
```

The timeout happened in B. A ran nothing after its pass. Thus the `Origin` line is false. Cause (read in source code): `src/core/state/derive.ts` `unknownState` returns `{ ...previous, outcome: "unknown", observedAt, summary, … }`. It keeps `origin` and `commit` from the state before the timeout. `ledger.markUnknown` stores nothing under a key ("Nothing is stored under a key", `ledger.ts:418`). So a timeout is always the reading worktree's own event, but the state keeps the inherited label.

**Race control** (`run-race.sh`, outputs `run-race-output.txt` and `run-race-output-0.1.233.txt`). A and B start together on the same key. A's run times out and B's run passes. B stays `PASS`, own, with no notice. A's timeout leaves no result that B could inherit. This agrees with `markUnknown`: another worktree's timeout cannot reach this worktree as an inherited result. (verified by experiment)

**Original incident (inferred).** The issue's `why` says `observed at revision 6, commit 9aaec09` and `Origin: inherited from <another task worktree> at 9aaec09`. The observation commit and the origin commit are the same, and the synthetic case gives the same pattern. The likely sequence: the reporter's worktree inherited a PASS made at 9aaec09. The setup edit re-keyed the 671-test file. The reporter's own run of it timed out at 600 s under load 30 to 48, and the state kept the inherited origin. The issue reads `why` as proof that the timeout came from another worktree "at another commit". Squeal's output does not support that. Not determined, because the incident's store was not read: the worktree's own HEAD and its tier run records at revision 6.

## Q2: setupFiles and inherited results

**Spec.** 011 C3's environment hash holds "the closure of every `setupFiles` and `globalSetup` entry". 013 V6 repeats this for Vitest. **Source** (0.1.234): `src/runners/vitest/project.ts` `projectInputs` builds `importClosure(project, project.config.setupFiles)`, and `isProjectInput` makes a change to it affect every test file of the project.

**Experiment** (`run.sh`, outputs `run-output.txt` and `run-output-0.1.233.txt`). B inherits A's results under keys `0455028fa64b` and `4571d6b8c82d`. B then edits `setup.ts`, and both keys change, to `cc2afa289e36` and `98dcc88ecae1`. B's checkpoint at revision 1 reports "2 test files, 0 already current, 2 run now", and `why` shows B's own result at revision 1. The keys match on 0.1.233 and 0.1.234. `run-own.sh` also confirms it: after the edit, B ran `slow.test.ts` itself (it timed out) and took nothing from A's key `09e3109ac0b1`.

So the second friction point in the issue ("a result from a commit without the edited setup file applies here") does not hold. The result was not applied: it was the stale origin label described in Q1.

**Side finding** (verified by experiment, both versions). After the setup edit, B's notice ends with `No result for setup.ts: no test Squeal runs reads it. Run whatever tests it yourself.` (`src/harness/shared/uncovered-edit.ts:50`). This is false for a `setupFiles` entry: in the same notice, Squeal re-keyed both test files because of that edit. This may be another reason the reporter mistrusted the setup handling.

## Recommendation for Squeal

- Q1 is a real bug with two parts. (a) The UNKNOWN notice and `status` give no origin. (b) A timed-out or crashed check keeps an `inherited` origin and commit that it does not have. Fix (b) first: once `unknownState` sets the origin to `own`, the notice and `why` tell the truth even without a new origin line. The issue's first acceptance criterion then needs a decision: an UNKNOWN state is never stored under a key (D12), so it is never inherited, and an origin line on UNKNOWN blocks would always say `own`.
- Q2 needs no product change. Close its acceptance criterion as already met, with this file's keys as the evidence.
- Triage the uncovered-edit sentence for setup and config files as its own issue.

## Open questions

- The incident's exact sequence is not determined (see Q1). Reading the cezarion store's revision 6 run records would settle it.
- Do other paths copy `previous.origin` the same way? Only `unknownState` was checked. `stateWithoutResult` also spreads `previous`, but there that is correct: its result is still the inherited one.

## Commands

Each was run from the worktree root, with `P=docs/specifications/011-core/research/probes/issue-66` and `CLI=$HOME/.claude/plugins/cache/hearsay/squeal/<v>/dist/cli/squeal.mjs` for v = 0.1.234 and 0.1.233. Before each one, `until awk -v n=$(nproc) '{exit !($1 < n)}' /proc/loadavg; do sleep 5; done` waited until the load was below the CPU count.

```
$P/run.sh      $CLI /tmp/issue66-probe | /tmp/issue66-run-233   > run-output*.txt
$P/run-race.sh $CLI /tmp/issue66-race  | /tmp/issue66-run-race-233 > run-race-output*.txt
$P/run-own.sh  $CLI /tmp/issue66-own-<v>  > run-own-output-<v>.txt
```

Each script sets `HOME` and `XDG_RUNTIME_DIR` to its scratch directory. The store is in the scratch repository's `.git/squeal`. No real HOME, store or socket was touched. The `*-1-*` output files are first attempts with a sequencing fault in the script; the README names each one.

`squeal --version` on the terminal: 0.1.234 (the launcher notes that Claude Code has 0.1.233). Vitest 5.0.5, Node 24.21.0.
