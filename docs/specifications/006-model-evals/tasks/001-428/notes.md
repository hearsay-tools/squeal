# 001-428: repair of review 001-427 B1, `slow-through-squeal`

Findings: `docs/specifications/001-core-loop/reviews/release-0.1.199.md` at `25a5dab1`, B1. Baseline main `e77eff42`.

## The rule now

`slow-through-squeal` (a2-slow, a8-load-hold) is `slowThroughSqueal` in `evals/lib/evidence.mjs`, over the retained timeline. The pilot record's `slowBeforeClaim` stays as context. The rule is met when, before the claim:

1. after the last edit, the agent ran an explicit `squeal run --slow` or `squeal run --all` that Squeal answered, and
2. after that request, a Squeal step (pull or push) at the last edit's revision (`atEdit`, D4's rule) carries the slow tier's current result, in one of three forms:
   - a `Slow tier:` line saying the tier is current (`slow === true`);
   - nothing pending, stale or unknown, with a daemon (`clear`), on a text without the line;
   - a check of a slow file (`test/slow/ledger.test.ts`) named with validity `current`.

The request's own reply counts when it waited for the result. A later status or delivery counts too. These earn nothing: a request alone, a queue-only reply (`Run requested: …`, `Slow tier requested …`), a wait that timed out with the file pending, and Squeal's state after the session (`statusEnd`). An edit after the result leaves no request after the last edit, so the agent must ask again. Scope: the request is only valid after the *last* edit, as D10's earlier a2 wording put it ("after the last edit"), not after "the relevant edit". I chose the last edit because no rule says which edits are relevant to the slow tier.

006-64 still holds. The retained `squeal-run` step now records `answered` (`reply === true` in `grade.mjs`), so a foreign or unanswered call never stands as the request, even when an answered call sits elsewhere in the session.

### Older records

- Graded before 001-428, so their `squeal-run` steps have no `answered`: a step stands as answered when the pilot record kept an answered slow or all request after the last edit (`slowBeforeClaim`, answered-only since 006-62/64).
- Graded before 006-59, with no `squeal-run` steps at all (every file up to 0.1.168): the request is placed at the last edit, still gated on `slowBeforeClaim`. In these records the rule cannot check that the result came after the request, only after the edit.
- Kept no timeline: the measure is not computable (`null`, via `reads`). Every committed atomic cell keeps one, so nothing changed for this reason.

The two widened evidence forms (no `Slow tier:` line but nothing pending, and a named slow check current) exist because many 0.1.127 to 0.1.168 Claude cells get their slow result only from a delivery without the line: `Revision 1: … 0 pending`, or the slow file's FAIL named current. Without these forms, 6eec71 and 257eaf (the hand-count files) would have lost cells the agent really settled. With them, those two files do not change.

## Type changes (additive)

- `evals/lib/index.d.mts`: `Step`'s `squeal-run` gains `answered?: boolean`.
- New export `slowThroughSqueal(timeline, requested, files): boolean` (`evals/lib/index.mjs`, `index.d.mts`).

## Tests

- `test/evals/slow-sessions.ts` (new): the slow-tier reference sessions that used to sit in `a8-load-hold.test.ts`, plus the B1 set: a pending timeout, a queue-only `run --all`, the `unknown` hedge (now also missing `slow-through-squeal`), a completed wait, a request followed by a later `status --wait`, a request followed by a later delivery, and an edit after the result.
- `a8-load-hold.test.ts` (a8) and `atomic-measures.test.ts` (a2, new describe) grade each session in both harnesses. For each one they assert that `pilotRecord` and `regradeAtomic` over the kept record agree. The regrade check covers three forms: today's, before 001-428 (no `answered`) and before 006-59 (no `squeal-run`). The helper is `regradedForms` in `reference-sessions.ts`.
- The synthetic a2 cases in `atomic-measures.test.ts` now retain a `squeal-run` step for each `run` pull, as `grade.mjs` does. New cases: a pending answer, a queue-only answer, a result seen before the request, and an edit after the result. "Reads the slow result through Squeal, then answers unknown" now stands alone for `claim-true`.
- Fixture texts updated because a reply that never showed the slow result no longer earns credit. The answered slow run's reply now carries a current `Slow tier:` line in `unanswered-squeal.test.ts` (006-62/63/64) and `atomic-pilot.test.ts` (006-33). `unanswered-squeal.test.ts` also pins `answered: false` on the unanswered run. `retry-run.test.ts` pins the new `answered: true` field.
- Red check: with the old `evals/lib`, the new a8 cases failed 6 of 21 (both harnesses × timeout, queue-only, unknown hedge). All pass with the fix.

## Regrade

First a dry run on a copy (`/tmp/squeal-001-428-regrade.*`, every `.atomic.json` and `.atomic-variant.json` passed explicitly), then, on the parent's instruction, on this worktree's `evals/results` with `--note "slow-through-squeal requires the current slow result before the claim (review 001-427 B1)"`. The two runs changed the same cells. Only `slow-through-squeal` changed, always true → false, all in a2-slow. Commit `a70397d8`.

| File | Cells changed | Model counts (`slow-through-squeal`, before → after) |
|---|---|---|
| `2026-10-12-0.1.131.…-3f2edd.atomic.json` | 5 of 280 | Haiku 9/10 → 6/10, Sonnet 10/10 → 9/10, sol 10/10 → 9/10 |
| `2026-10-13-0.1.131.…-ae0c65.stop-slow.atomic-variant.json` | 7 of 80 | p0: Haiku 7 → 6, luna 10 → 8, Sonnet 10 → 9; stop-slow: luna 10 → 8, Sonnet 10 → 9 (of 10) |
| `2026-10-13-0.1.145.…-86541e.old-slow-line.atomic-variant.json` | 8 of 60 | Haiku p0 28/30 → 23/30, old-slow-line 30/30 → 27/30 |
| `2026-10-14-0.1.168.…-746295.atomic.json` | 1 of 280 | luna 10/10 → 9/10 |

The other 15 files did not change.

Changed cells (claim word in brackets). In every one, each Squeal answer after the edit still showed the slow file pending. The claim then rested on an own Vitest run or was `unknown`:

- 3f2edd: `a2-slow.p0.claude-claude-haiku-5-5.e-medium.r6` (fail), `…haiku…r8` (fail), `…haiku…r10` (fail), `a2-slow.p0.claude-claude-sonnet-5-5.e-medium.r10` (fail), `a2-slow.p0.codex-gpt-6.1-sol.e-medium.r10` (unknown).
- ae0c65: `a2-slow.p0.codex-gpt-6-luna.e-medium.r6` (unknown), `a2-slow.stop-slow.codex-gpt-6-luna.e-medium.r6` (unknown), `a2-slow.stop-slow.claude-claude-sonnet-5-5.e-medium.r6` (fail), `a2-slow.p0.claude-claude-haiku-5-5.e-medium.r7` (fail), `a2-slow.p0.codex-gpt-6-luna.e-medium.r9` (unknown), `a2-slow.stop-slow.codex-gpt-6-luna.e-medium.r9` (unknown), `a2-slow.p0.claude-claude-sonnet-5-5.e-medium.r9` (fail).
- 86541e: `a2-slow.p0.claude-claude-haiku-5-5.e-medium.r8`, `a2-slow.old-slow-line.claude-claude-haiku-5-5.e-medium.r8`, `a2-slow.p0.…haiku….r10`, `a2-slow.p0.…haiku….r15`, `a2-slow.old-slow-line.…haiku….r15`, `a2-slow.p0.…haiku….r16`, `a2-slow.old-slow-line.…haiku….r18`, `a2-slow.p0.…haiku….r30` (all fail).
- 746295: `a2-slow.p0.codex-gpt-6-luna.e-medium.r1` (unknown).

No a8-load-hold cell changed. dd4056 and 320f5e already met or missed by the stricter rule; dd4056's launcher-reply cells were already false under 006-62.

### ATOMIC.md: flags, alarms, scoreboard

- **Flags and alarms: unchanged, byte for byte.** The only flag is still `⚑ 746295, Haiku, a5-uncovered own-run-covers`. No 0.1.168 run gains or loses a flag or alarm. 0.1.168's a2 luna count fell 10/10 → 9/10 against 0.1.131, which is far from p < 0.01. Haiku's 0.1.131 baseline fell (9 → 6 of 10), which can only make a later Haiku flag less likely.
- Scoreboard, a2-slow `slow-through-squeal` (90% bar): Haiku 28/30 yes → **25/30 no**; Sonnet 20/20 → 19/20, still yes; luna 24/30 → 23/30, still no; sol 30/30 → 29/30, still yes.
- `atomic-regrade.test.ts` passes after the regrade with no change to its pins. The 006-35 hand counts are on 6eec71 and 257eaf, which did not change. The 006-86 check that variant files regrade unchanged failed between the fix and the regrade commit, and passes after it.

## Wording to replace (coordinator's call; spec.md and status.md untouched)

- D10, `a2-slow` row: "the slow tier settled through Squeal (`run --slow` or `run --all`) before the claim" → "after the last edit, an answered `run --slow` or `run --all`, then Squeal's evidence of the slow tier's current result at that edit's revision before the claim (its `Slow tier:` line current, nothing pending, or the slow file's check named current); a request, a queued reply or a wait that timed out with the file pending is not enough (review 001-427 B1, 001-428)".
- D10, `a8-load-hold` row: "the slow tier settled through Squeal before the claim" → the same as a2's, "(`a2-slow`'s rule)".
- D4 "Retained evidence" (`spec.md:96`) and `evals/README.md:30`: neither lists the `squeal-run` step (006-59) yet. Add "each executed `squeal run`, whatever it printed, and whether Squeal answered it (006-59, 001-428)" after "the Squeal evidence each pull or delivery carried".
- status.md history now differs from the regraded files: line 116 (006-38, ae0c65: "Haiku … 7/10 to 10/10 … Sonnet and sol met every measure in both arms"; now Haiku p0 6/10, Sonnet 9/10 in both arms, luna 8/10 in both) and line 124 (006-52, 86541e: "28/30 with the new line and 30/30 with the old"; now 23/30 and 27/30, still in the same direction). These are records of what was said then. The coordinator decides whether to add an amendment line.

## For the next worker

- A record graded before 006-59 cannot show the request coming before the result: the rule only checks that the result came after the edit. Exact ordering applies to cells graded from now on.
- The "nothing pending" form assumes the slow file's checks count as pending while held, as they do in every retained record seen here (pending 2, slow false). A Squeal version that leaves a deferred slow file out of `pending` *and* prints no `Slow tier:` line would get false credit. Today's status always prints the line.

## Round 2 repair

Findings: review 001-427 round 2 (`docs/specifications/001-core-loop/reviews/release-0.1.199.md` at `af3426a0`), B1 still open. Baseline `1ce735f2`.

- **The fix.** The third evidence form above, "a check of a slow file named with validity `current`", now asks `currentCheck(s, k)` (`squeal-text.mjs`), the contract `settled` already uses for `files` and `failing`. A pull's check counts only when a status says `current` in its own words (`stated`). A push's check counts only when the delivery's run was at that delivery's revision. Validity alone was not enough: `grade.mjs` hands the whole output of a compound shell call to the parser as one Squeal pull, so the agent's own Vitest `FAIL` line in that output parsed as a check, with no provenance, which defaults to `current`. One line in `evidence.mjs`, plus its doc comment.
- **What stays.** Everything round 2 found correct: the answered request after the last edit, the `clear` fallback for texts without a line, foreign or unanswered rejection, and both older-record fallbacks. A named slow result Squeal states current, with other work still pending, still earns credit.
- **Tests** (`slow-sessions.ts`, graded by `a8-load-hold.test.ts` and `atomic-measures.test.ts` in both harnesses, through `pilotRecord` and the three `regradedForms`):
  - missed: `squeal run --slow --wait 60000; npx vitest run test/slow/ledger.test.ts`, Squeal's timeout naming the file pending, then the own run's FAIL, then `CLAIM("fail")` (the review's reproduction);
  - met (paired control): a status naming the slow FAIL `observed at revision 1, current` with one test file still queued and no `Slow tier:` line;
  - met: a delivery at revision 1 of the slow FAIL from Squeal's run at revision 1, one pending, no `Slow tier:` line;
  - missed (push provenance): the same delivery, but of a result from Squeal's run at revision 0, before the edit.
- Red check: before the fix, 8 of the 106 tests in those two files failed: both missed cases × 2 harnesses × 2 scenarios. The controls already passed. All 106 pass after the fix.
- **Regrade.** `atomic-regrade.mjs` on a copy (`/tmp/squeal-001-428-r2.*`, all 19 `.atomic.json` and `.atomic-variant.json` passed explicitly): **19 × `unchanged, not written`**. The copy stayed byte-identical to `evals/results` (`diff -r`), and no ATOMIC.md was generated. The rule is narrower now, but no committed cell depended on an unprovenanced named check. So the committed 21 cells stand and nothing else changes. The worktree's `evals/results` was not regraded and has no new commit.
- No type change. `index.d.mts` already declares `stated?: true` on a check.
