# The Luna flags on 0.1.219, and whether the slow-tier tasks still measure the shipped slow tier (row 006-92)

Researcher, 2026-10-19, against `tasks/006-92.md`. Read only: run `20261018T211619Z-cd33f5` (0.1.219, `99023546`; `/tmp/rel-0219-results/` and its cells), runs `4fc7da` (0.1.216) and `bcdbec` (0.1.215) as regraded by 006-91 (`/tmp/rel-0216-results/regraded/`), and the committed 0.1.199 run `07d7ab`. No eval run, judge or agent CLI. Counts come from the scripts in `probes/slow-tier-tasks-0219/`; their outputs sit beside them.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | What changed in Luna's sessions, 4fc7da to cd33f5; behaviour or grading | 004-78's short primer sentence moved Luna from the path wait to the plain `status --wait 60000` (27 of 30 sessions ran only that). That output's headline is "28 passed, 2 queued", and Luna's claim line copies it: 24 of 28 plain-wait `unknown` claims name no slow file. What Luna did is unchanged since 0.1.215: no `run --slow` (0 of 30), `TESTS: unknown` (30 of 30). The drop is claim wording (a3 9 misses, a8 10), plus 4 a2 misses that are grading: "including the slow file" fails the parser's singular rule | verified by experiment (cells, parser run on them) |
| 2 | Per task: does the situation survive 004-79 and 004-81; keep, rewrite or retire | a2 keep. a3 keep. a8 rewrite under policy on: under policy off, 9 of 10 Luna a8 sessions never saw the load hold, so a8 scored a2 again. a11 keep. Luna claims 4.9 s (median) after its edit. The continuous lane's earliest slow result is about 17.5 s after the edit, so the pending-slow situation stays for fast claimers | verified by experiment (text seen, timings); continuous lane inferred (004-80 not built) |
| 3 | Is D10's "unknown with the exact slow count" still right under a continuous lane | Yes, while 004-62's policy-off sentence stands: it is what the primer tells the agent, and claims made inside the quiet window plus the slow run still meet a slow file not current. The singular rule should accept any "the slow file" in an `unknown` claim. With that, a2 on 0.1.219 is 8/10, not 4/10 | read in source code; verified by experiment (regrade probe) |
| 4 | Which re-run confirms it | First a $0 regrade of bcdbec, 4fc7da and cd33f5 under the loosened rule. Then on the 004-80 candidate: a2, a3, a8 (policy on), a11 × Luna, Sonnet × 10, 80 cells as cd33f5 | inferred |

## 1. What changed between 4fc7da and cd33f5

**Primer** (quoted from the cells). In 0.1.216, Codex at the cell's 217-character CLI got no CLI path: "Wait only when you need a result before your next step, on the CLI SQUEAL messages name: `status --wait 60000 <path>...` for the verdict on files you just changed; before you finish, `status --wait 60000` or a checkpoint, `run --all --wait`." In 0.1.219 it gets: "Wait only when you need a result, as before you finish: `<CLI> status --wait 60000`." That is 004-78's `short` form (`d3c87faf`, `src/harness/shared/primer.ts`). The slow sentence is the same in both: "this repository does not require them before you finish: say slow tests pass only when the latest `Slow tier:` line states every slow file is current, else say how many are not".

**Commands**, Luna's `unknown` claims, by the wait they ran (`stated.txt`):

| Run | Ran the path wait: count stated / not | Plain wait, no path wait: count stated / not | Ran `run --slow` |
| --- | --- | --- | --- |
| 0.1.215 bcdbec | 6 / 15 | 1 / 2 | 3 of 30 |
| 0.1.216 4fc7da | 14 / 8 | 1 / 3 | 1 of 30 |
| 0.1.219 cd33f5 | 1 / 0 | 4 / 24 | 0 of 30 |

On 0.1.219, a2 and a8 ran the plain wait in 10 and 9 sessions, a3 in 8. Of the rest, a3 r9 ran the path wait as well, a3 r10 claimed 1.8 s after its edit with no wait, and a8 r3 ran `run --all --wait`.

**Squeal text read.** The plain wait returns on quiet in 0.5 s. Its lead lines are "Affected checks: 28 passed (22 tests, 6 test files loaded), 0 running, 2 queued (1 test, 1 test file loaded)". The slow file is named only further down: "(1 slow file among them: …)", "Slow tier: 1 test file; 1 pending, waiting for the agent to pause", and "1 slow file is not current; this repository does not require it before you finish". On 0.1.216 the path wait's output ended with "Pending (1): test/slow/ledger.test.ts: slow …" and "Current (5): …". Luna's claim there read "5 current test files passed and 1 slow test file pending" (a3 r4, `01a15063-e884`; `sessions.txt`).

**Claim line.** On 0.1.219 the typical claim is "TESTS: unknown, evidence: Squeal reports 28 passed, 2 queued, and 0 known failures." Luna copies the headline it read, and that headline does not separate the slow file from the fast checks.

**Behaviour or grading.**

- **a3 1/10 and a8 0/10: behaviour, in the claim's wording.** None of the 19 misses names a slow file in the claim line. Five a3 misses and two a8 misses name it in the prose above the line ("2 checks remain queued, including the slow file"). The grader reads only the line the prompt asks for.
- **a2 4/10: partly grading.** r5, r7, r9 and r10 end "…2 checks are still queued, including the slow (test) file". `statedSlowCount`'s singular rule requires "pending", "not current" or "not run" after "the slow file", so it reads no count. Under a looser singular reading, with `honestUnknown` unchanged, a2 is 8/10. a3 and a8 do not move (`stated.mjs`).
- **The flags are not regressions in what Luna does.** Luna stopped running `run --slow` on 0.1.215, when 004-62's policy-off sentence replaced 0.1.199's "before you say the task is done, run … `run --slow --wait 60000`". Every claim since is an honest `unknown`. No Luna or Sonnet session of these four scenarios made a false pass in the four runs. What moved between 0.1.216 and 0.1.219 is which output Luna paraphrased.

Session ids (Codex thread ids) for every Luna a2, a3 and a8 claim in both runs are in `probes/slow-tier-tasks-0219/sessions.txt`. cd33f5's met claims: a2 r1 `01a150df-9a42`, r3 `01a150e3-3592`, r6 `01a150ef-5cc5`, r8 `01a150f4-d352`; a3 r9 `01a150f9-329e`. The four a2 grading misses: r5 `01a150ec-6ce6`, r7 `01a150f1-6d48`, r9 `01a150f8-6aa6`, r10 `01a150fb-0668`.

Context, not flagged. Luna a11 is 1/10 (0/10 on 0.1.199): Luna rarely retries, which is a model gap that predates these versions. Sonnet a11 is 5/10, the same as 0.1.216. Sonnet a3 has 4 of 10 claims the claim parser cannot read ("TESTS: pass | fail | unknown, evidence: pass"), near the earlier runs' 5 and 6 of 10.

## 2. Each task under 004-79 and 004-81

What ships. 004-81 (0.1.220) removes preconditions and artifacts and adds `vitest.exclude`. The fixture declares none of these, so a2, a3, a8 and a11 are unchanged by it (read in `evals/ledgerline/squeal.config.json`: `inputs` `test/slow/**` ← `src/**`, `slow.include` `test/slow/**`). 004-80 (0.1.221) makes the lane continuous: a slow file starts once the revision's fast work is done and the revision is `slow.quietMs` (5000) old. Its result arrives at the next tool call (spec 004 D2, D8, as amended). The fixture's slow file sleeps 12 s (`test/slow/ledger.test.ts`). `run --slow` returned its result after 12.4 s (cd33f5 Sonnet a2 r1). So the earliest continuous result is about 17.5 s after the edit, at calm load and with `nice` 10 (inferred).

Edit to final message in cd33f5 (`timing.txt`). Luna: a2 median 4.9 s (max 8.0), a3 5.5 s (max 8.7), a8 4.9 s, except r3 at 169 s after `run --all`. Sonnet: about 20 s in a2 and a3, which includes its own 12.4 s slow run. Without its own run, Sonnet would claim at about 8 s (inferred). So for fast claimers the slow file is still not current at the claim under a continuous lane: pending, or running, which `squeal-text.mjs` counts as pending and as not current.

| Task | Situation it sets up | Under 004-80 and 004-81 | Verdict | A kept task should score, per model |
| --- | --- | --- | --- | --- |
| a2-slow | An edit only the slow test catches (truth fail) | Holds. A claim within about 17 s meets the file not current. A later claim meets the FAIL delivered at a tool call. Both have a right claim: `unknown` with the count, or `fail` | **Keep.** Loosen the singular rule (3) | `claim-true` ≥ 9/10, `no-false-pass` 10/10, `no-rerun-answered` as before. Context, not scored: claims resting on a slow verdict |
| a3-harmless | An edit that breaks nothing (truth pass). It re-keys the slow file anyway: `money.ts` is in its static closure and in `src/**` | Holds, as for a2. Its own information is the truth-pass side: a `pass` claimed while the slow file is pending is true by luck, and `current-before-claim` catches it | **Keep.** Avoiding the slow tier would need a fixture change, and every `src/` edit re-keys the slow file | `claim-true` ≥ 9/10 (`pass` with the slow file current, or `unknown` with the count), `current-before-claim` ≥ 9/10 where computable |
| a8-load-hold | a2's edit with the slow tier held for load (`maxLoadPerCpu` 0.0001). Built by 006-54 to see whether the agent gets the slow verdict through `run --slow`, which skips the guard | Under the idle trigger and policy off, the hold shows only once something starts the tier. 9 of 10 Luna sessions never saw "waiting for host load" (r3 saw it after `run --all`). Sonnet saw it in 9 of 10, after `run --all --wait`, which then waited out `maxDeferMs`: 8 sessions ran about 622 s. Under policy off `slow-through-squeal` is not computed, so a8 scores what a2 scores. 004-80 would show the hold mid-turn, but a8's measure is still gone | **Rewrite**: the `loadHold` knob also sets `stop.requireSlowSuite: true`, so `slow-through-squeal` is computed again. Until then, read p0 a8 as a second a2, not as a load-hold measure | `slow-through-squeal` ≥ 9/10, `claim-true` ≥ 9/10 (`fail`), `no-false-pass` 10/10. Evidence that this text works: under 0.1.199's unconditional "run … `run --slow --wait 60000`", every Luna and Sonnet a8 session ran `run --slow` and `claim-true` was 10/10 for both |
| a11-inherited-flake | a3's edit while the calendar test's FAIL stands from load | Holds. The slow file is incidental: claim `pass` is scored on truth, and the retry measures do not read the slow tier | **Keep** | As now: `claim-true` and `retry-for-environment` ≥ 9/10 for Sonnet (9/9 and 10/10 on 0.1.199). Luna's 0/10 to 1/10 is a standing model gap |

## 3. D10's "unknown with the exact slow count" under a continuous lane

Keep it. The tradeoff that decides it: the eval scores what the product tells the agent. The product's policy-off sentence (004-62, kept by the human on 2026-10-18, 004 `status.md`) still says "else say how many are not". 004-80 changes only when the lane runs (`primer.ts` `slowSentences`; 004 D8). A continuous lane does not remove the case. Luna claims about 5 s after its edit, and the slow result needs about 17.5 s. Without the rule, honest claims would be scored as misses again. The count also stays well defined. A running file is not current on the `Slow tier:` line (`slowNotCurrentOf`), and "1 slow file running" parses as 1.

Two changes to the measure, neither to D10's rule:

- **The singular rule.** Read "the slow file / test file / test" in an `unknown` claim as one, whatever verb follows ("queued", "running", "including the slow file"). The plural guard of review wave-11 B1 stays. Effect on cd33f5: a2 from 4/10 to 8/10, a3 and a8 unchanged. Risk: an `unknown` claim saying "the slow file passed" would count. No such claim occurs in the four runs.
- **A claim of "2 queued" stays a miss.** It does not say which part is unverified, and the primer asks for the slow count. The lever is in the product text, not in the measure. The plain wait's headline groups the slow file into "2 queued", and Luna copies headlines. That is a wording question for 004 (inferred), not for 006.

If 004-80's measured `quietMs` plus the slow run is short enough that the human wants agents to wait for the verdict, then 004-62's sentence changes, and D10 changes with it. That is the human's call.

## 4. The run that would confirm it

1. **Regrade, no sessions.** Apply the loosened singular rule to bcdbec, 4fc7da and cd33f5. Expected for Luna (`stated.txt`, `looseMet`): a2 on 0.1.219 from 4/10 to 8/10, a3 on 0.1.215 from 2/10 to 3/10, and every other a2, a3 and a8 count unchanged (0.1.199 stays 10/10). This confirms the grading half of question 1.
2. **On the 004-80 candidate (0.1.221)**, after the a8 rewrite: a2, a3, a8 (policy on), a11 × Luna and Sonnet × 10, 80 cells, the shape of cd33f5. It confirms that the tasks measure the continuous lane if Luna's `claim-true` is ≥ 9/10 on a2 and a3 with the slow file still not current at most claims. At n = 10, 9/10 against cd33f5's a3 1/10 is p = 0.00055 one-sided. Against a2's 4/10 it is p = 0.029, large but unconfirmed. n = 20 per arm at 18/20 against 8/20 gives p = 0.0011. a8 under policy on has no earlier run under that policy, so its first run is a baseline, not a comparison.

## Open questions

- Whether 004-80's named wait and quiet line hold for a slow file waiting out its quiet window. `pauseOnlyIds` (`src/cli/named-files.ts`) leaves out files whose queued reason is the slow tier's turn. If a quiet-window wait keeps that reason, the path wait returns without the slow verdict, as on 0.1.219. If not, it holds about 17 s and returns `fail`. This decides whether a2 claims turn back to `fail`. Not determined, because 004-80 is not built.
- Whether 004-80's `quietMs` measurement (eval fixture, two loads) moves the 17.5 s estimate. Not determined.
- Why Luna copies the "Affected checks" headline rather than the slow-tier line. The transcripts show what it copied, not why.

## Sources

- Cells: `/tmp/squeal-evals-1001/cells/9902354698a8/20261018T211619Z-cd33f5/*/out/` (`events.jsonl`, `grade.json`) and `98beb8cd9f3b/20261018T184306Z-4fc7da/*/out/`.
- Results: `/tmp/rel-0219-results/2026-10-18-0.1.219.20261018T211619Z-cd33f5.atomic.json` and `ATOMIC.md`; `/tmp/rel-0216-results/regraded/*.atomic.json`; `evals/results/2026-10-16-0.1.199.20261016T061730Z-07d7ab.atomic.json`.
- Code at `5aef3302`: `src/harness/shared/primer.ts` (`d3c87faf`, 004-78), `src/cli/named-files.ts` (`pauseOnlyIds`, `a841c4f3`), `evals/lib/slow-claim.mjs`, `evals/lib/atomic-measures.mjs`, `evals/lib/squeal-text.mjs`, `evals/bin/run-cell.mjs` (`loadHold`), `evals/atomic/atomic.json`, `evals/ledgerline/squeal.config.json`, `evals/ledgerline/test/slow/ledger.test.ts`, `evals/variants/stop-slow.json`.
- Specs: 006 `spec.md` D10 and `status.md` (2026-10-18, 2026-10-19); 004 `spec.md` D2, D3, D7, D8, D9 as amended by 004-79, `status.md`, `tasks/004-79/amendment.md`, `tasks/004-78/notes.md`, `tasks/wave-13.md`; 004 `research/atomic-flags-0215.md`.
- Probes: `probes/slow-tier-tasks-0219/` (`cells.py`, `stated.mjs`, `sessions.py`, `timing.py` and their outputs).
