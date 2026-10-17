# Issue 31: edited fast tests behind broad dependent suites

Researcher findings, 2026-10-17. Source: hearsay-tools/squeal#31 (opened 2026-10-17T11:24Z, Squeal 0.1.199,
from cezarion#1225). Examined at checkout `276fbaf0` (package 0.1.208) and tag `squeal--v0.1.199`.

**Verdict: reproduced in a synthetic scheduler probe, not reproduced live.** The real `RunQueue` and
`joinSpan` rank a directly edited test file *after* a long direct importer of the same edited source
whenever the edited file has no last-known duration. They never rank a changed test file ahead of other
direct importers: the two share the `direct` class and are sorted by duration. Together with C15's rule that
a running tier is never split, this gives the issue's timeline: a 9-minute tier already running, then an
8-minute direct importer, then the edited test. Nothing changed between 0.1.199 and HEAD (`queue.ts` and
`sharing.ts` are byte-identical, and the probe output is identical).

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Is a directly edited test file distinguished from indirect invalidations? | Partly. A changed test file is `direct` (class 1), and so is every test file the runner reports as a direct importer of the edited source. Both are `recent`. A transitively affected file is class 2. There is no rank for "this test file itself was edited". | read in source code (HEAD, 0.1.199), verified by experiment |
| 2 | Does duration ordering put the edited file behind long suites? | Yes, when its duration is unknown: `sorted` maps `null` to `+Infinity`, so it goes after every known-duration file in its class, 540 s and 480 s suites included (scenarios B, F). With a known short duration it goes first (A, G). Behind shorter direct importers it waits its turn by duration (D: 6th of 15, after one 6 s tier). | verified by experiment |
| 3 | Can the edited file share the long suite's tier? | No. `joinSpan` counts an unknown duration as 0, which shares only below `SHARE_FLOOR_MS` (1 s), so the edited file waits for that tier to end and then leads the next one (B: after about 540 s; F: after about 480 s). | verified by experiment |
| 4 | Does a running tier block it? | Yes, by design: a running tier is never cancelled or split for an edit or a promotion (C15 Rank, which defers this to 001-381). Taking harness-parity out as "running" (E, F) moves the edited file up only if no other known-duration direct importer remains. | read in official docs (spec 011 C15), verified by experiment (E/F) |
| 5 | When is an edited, existing test file's duration unknown? | When the daemon's bootstrap finds it a miss with no previous key *for this worktree* (`bootstrap.ts` 155-157 `continue` before setting `durationMs`), e.g. a fresh task worktree whose daemon starts after the edit, or a file that is new. A file that was a lookup hit at bootstrap gets its duration (`ledger.ts` 301) and keeps it across re-keys. | read in source code (HEAD) |
| 6 | Did the cezarion file have no duration in that session? | Not determined, because the session's store was not available. `worker-wait-durability.test.ts` has existed in cezarion since 2026-09-08 (`gh api .../commits?path=...`), so it was not new; an unknown duration needs the bootstrap case in 5. | inferred |
| 7 | Why did `why '<new test name>'` say `No check matches`? | Name lookup, not scheduling. `readWhy` matches only checks in this worktree's known states and held fails. A test case that has never run has no check row, and `formatWhy` prints the same `No check matches "…" in this worktree.` at 0.1.199 and HEAD, with no hint that a queued file may hold it. | read in source code (HEAD, 0.1.199) |
| 8 | Is this named demand (#14/#17, 011-11/12) or selection (#30/#6, 005-67)? | No. The probe uses no named wait and no selection. C15 promotion would rank a *named* test file first, but the issue's agent waited on a test name via `why`, and C15 promotes only paths. Different from #4 (slow tier ranking): every file here is fast-tier. | read in official docs (C15), inferred |

## Findings

**Class and order (questions 1, 2).** `priorityOf` (`src/core/scheduler/queue.ts`) returns `direct` for
`changed.has(file.ref.path) || direct.has(file.id)`. Both conditions give the same value, so an edited test
file and a broad suite that imports the edited `run.ts` are peers. `sorted` orders by recent, then class, then
`byDuration(durationOf ?? +Infinity)`, then sequence. Spec 011 C4 step 4 states this order ("then test files
that import a changed path directly … within a class, shortest last known duration first"), so the probe's
order is the specified behaviour, not a deviation. The issue asks for a rule the spec does not yet have: a
changed test file ahead of other direct importers.

**Unknown duration (2, 3, 5).** `sharing.ts` says of an unknown duration "a test file just written is never
held by a slow one". That holds within a tier, but ordering puts the slow file first, so the next tier holds
the new file anyway. That is the sharpest form of the defect (scenarios B, F).

**Running tier (4).** C15: "A running tier, whether an edit's or the backlog's, is never cancelled or split
for promotion: that question belongs to 001-381." The issue's first wait (about 9 minutes of harness-parity)
is this case, and the planned 001-381 owns it, not issue 31.

**Coverage.** The probe drops no file: every queued file reaches a tier in every scenario. A reorder alone
keeps "every invalidated file still runs" (acceptance criterion 2).

## Probe

`research/probes/issue-31/` (throwaway; README there). It loads the real `queue.ts` and `sharing.ts` with
Node 24 type stripping, stubbing `compare` and `testFileId` verbatim, and packs edit tiers as `selectTier`
does (tier size 4, `joinSpan`). Not modelled: lanes, claims, store lookups, the runner part's listing
(no tier starts before the revision is listed, C15), capacity, the starvation bound. Durations are the
issue's approximations (540 s, 480 s); the 20 s and 600 s edited-file durations are assumed.

Load before the run: `load average: 17.30, 13.66, 13.75` and `16.83, 13.86, 13.82` on `nproc` 24, so the
one-minute load was below the CPU count. The probe is in-process and sub-second. No daemon, Vitest, build or
cezarion suite was run.

Commands (from the worktree root):

    uptime; nproc
    node --import ./docs/specifications/011-core/research/probes/issue-31/register.mjs \
      docs/specifications/011-core/research/probes/issue-31/order.mjs > .../output-current.txt
    T=$(mktemp -d); mkdir -p $T/src/core/scheduler
    for f in queue sharing; do git show squeal--v0.1.199:src/core/scheduler/$f.ts > $T/src/core/scheduler/$f.ts; done
    node --import ./…/register.mjs …/order.mjs $T/src > …/output-0.1.199.txt
    diff …/output-current.txt …/output-0.1.199.txt   # identical

Key output (`output-current.txt`):

    == F: E, but monitoring-turn also imports run.ts directly (the issue's timeline)
     1. direct      480000 ms  packages/cezar/test/monitoring-turn.test.ts
     2. direct     unknown ms  packages/cezar/src/workflows/worker-wait-durability.test.ts
      tier 1: monitoring-turn.test.ts  (~480s)
      tier 2: worker-wait-durability.test.ts  (~0s)  <- edited test

## Recommendation for Squeal

Treat issue 31 as its own fast-tier ordering row, not a duplicate of #4, #14/#17, #30/#6 or 001-381:

1. Within the first group, rank a test file the revision itself added or edited ahead of other direct
   importers. Failing-first can stay as C4 has it; the issue allows that.
2. Do not let an unknown duration sort after known long ones in that rank. Treat a just-written file as
   short, which matches `joinSpan`'s 0.
3. Keep 001-381 as the owner of a running tier. Issue 31's fix bounds the wait to one running tier, not zero.
4. For acceptance criterion 4, `why` with no match could say how many test files in this worktree are
   queued without results under their current key. Squeal cannot know an unrun test's name, so it can say
   only "may be in a queued file", never "does not exist".

The spec change lands in C4 step 4 and C6 (`why`) through the coordinator; the regression the issue asks for
is scenario F as a `RunQueue` unit test.

## Open questions

- Whether cezarion#1225's daemon had a duration for `worker-wait-durability.test.ts` (question 6). If it did,
  the probe's order runs the edited file before monitoring-turn (G), and the delay after harness-parity has
  another cause, for example the unlisted revision, a claim, a lane in `busy` or the slow tier. That needs
  the session's store or daemon log.
- Whether monitoring-turn and harness-parity are direct or transitive importers of `run.ts` in cezarion's
  module graph. F (direct) reproduces the issue; E (transitive) does not.

## Sources

- https://github.com/hearsay-tools/squeal/issues/31 (fetched with `gh issue view 31 --json`)
- https://github.com/hearsay-tools/cezarion/issues/1225 (title, created 2026-10-17T10:04Z)
- cezarion `packages/cezar/src/workflows/worker-wait-durability.test.ts` history, `gh api repos/hearsay-tools/cezarion/commits?path=…`
- `src/core/scheduler/queue.ts` (`priorityOf`, `RunQueue.ordered`, `sorted`), `sharing.ts` (`joinSpan`),
  `tiers.ts` (`selectTier`), `ledger.ts` (`settle`, `recentOf`, line 301), `bootstrap.ts` lines 150-167,
  `src/core/status/why.ts` (`resolve`), `format-why.ts` line 24, at `276fbaf0` and `squeal--v0.1.199`
- `docs/specifications/011-core/spec.md` C4 step 4, C6, C15; `status.md`
