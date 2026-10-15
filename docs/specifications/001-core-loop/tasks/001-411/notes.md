# 001-411 `why` duration stats: notes

Wave 14 W3, commit a2edf683.

## Seam map

- `src/core/status/durations.ts`: `durationsOf(results)` and `durationsText(d)`, shared by the single-check line and the candidate suffix.
- `src/core/status/why.ts`: `durations: durationsOf(all)` over every stored result of the check (all worktrees, not only the 20 listed); each candidate's from `listForCheck(candidate, MAX)`, at most `WHY_CANDIDATE_LIMIT` (20) reads.
- `src/core/status/format-why.ts`: `Durations (...)` directly above `Results (...)`; candidates as `  <name>  (...)`.
- Types, additive: `WhyDurations`; `WhyReport.durations: WhyDurations | null`; `WhyNoMatch.candidateDurations`, parallel to `candidates`.

## Decisions the spec did not settle

- Skips are counted, not timed (a skip runs nothing, so its ~0 ms would pull min and median down): `N results` is pass plus fail, and `, S skip not timed` appears only when S > 0.
- Median and p95 are nearest-rank (always a stored value, no interpolation).
- One result prints its one duration: `Durations (1 result, 1 pass / 0 fail): 42 ms`. No pass or fail stored: no line, `durations: null`.
- Milliseconds rounded, as the result lines print them.

## Remaining

- The load range (task 001-404 stores it) is left out as briefed; add it to `WhyDurations` and `durationsText` once W1 lands.
