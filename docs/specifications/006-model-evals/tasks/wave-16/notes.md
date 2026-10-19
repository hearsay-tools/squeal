# Wave 16 notes: 006-93 and 006-94

Worker 64bbedbd, 2026-10-19, against `tasks/wave-16.md` and the 006-92 findings (`research/slow-tier-tasks-0219.md`). No eval run, judge or agent CLI.

## 006-93: the singular rule

`evals/lib/slow-claim.mjs` `SINGULAR` now reads any singular "the slow file" ("test file", "test") in an `unknown` claim's evidence as one slow file not current, whatever follows it ("2 checks remain queued, including the slow file", "the slow test is running"). Kept as before: the plural guard of review wave-11 B1 ("the slow test files" without a number states none), a bare "2 queued" states none, and counts that disagree state none.

**A decision the findings left open.** The findings accept one risk: "the slow file passed" would count. I kept that case out instead, with a narrow guard. The rule now reads none when "the slow file" is followed directly by a pass verb ("passed", "has also passed", "is passing"). No claim in any run has this form, so no count depends on the guard. The existing test case "the slow file passed" → none stays.

### Counts, `claim-true`, p0 (Luna; Sonnet where it moved)

Uncommitted runs, regraded as copies in `/tmp/w16-scratch/after/` (the originals in `/tmp/rel-0219-results/` and `/tmp/rel-0216-results/regraded/` are untouched, and nothing was committed from them):

| Run | Luna a2 | Luna a3 | Luna a8 | Sonnet a8 |
| --- | --- | --- | --- | --- |
| 0.1.215 bcdbec | 7/10 → 7/10 | **2/10 → 3/10** | 4/10 → 4/10 | 10/10 → 10/10 |
| 0.1.216 4fc7da | 6/10 → 6/10 | 6/10 → 6/10 | 7/10 → 7/10 | 10/10 → 10/10 |
| 0.1.219 cd33f5 | **4/10 → 8/10** | 1/10 → 1/10 | 0/10 → 0/10 | **9/10 → 10/10** |
| 0.1.199 07d7ab (committed) | 10/10 | 10/10 | 10/10 | unchanged |

Luna moves exactly as the findings expect (a2 r5, r7, r9 and r10 on cd33f5; a3 r9 on bcdbec). One more cell moved, outside the findings' Luna-only probe: Sonnet a8 r8 on cd33f5, "the slow file test/slow/ledger.test.ts is held for host load and hasn't run". Under the old rule, the "." in the path ended the clause before any verb, and "hasn't run" is not "not run". The new reading is right. Nothing else in the three files moved (diff of every task × model `claim-true` before and after).

Committed results, `node evals/bin/atomic-regrade.mjs --by 006-93 --note ...` (no `--judge`): 2 cells in 2 files changed, both `claim-true` `false` → `null`:

- `2026-10-12-0.1.131…3f2edd`, Haiku a3 r6, and `2026-10-14-0.1.168…746295`, Sonnet a3 r10. Both name "the slow file test/slow/ledger.test.ts", which never ran. Their timelines predate the `Slow tier:` count (graded before 006-91), so under 006-91's rule a stated count is not computable. Before 006-93 they stated no count, so they were a miss.
- ATOMIC.md: Haiku a3 `claim-true` 26/30 → 26/29; Sonnet a3 12/14 → 12/13, which now reads "yes" on the adoption scoreboard (≥ 90%). No flag or alarm moved; `test/evals/atomic-trend.test.ts` passes.
