# Research: the slow tier's value in practice, and an advisory slow tier

Row 004-75. Brief: `slow-tier-advisory-brief.md`. Researcher, 2026-10-18, Opus 5.5. Follows `slow-tier-role.md` (004-74). Examined: Squeal at `06cc5da0` (0.1.215 plus docs); cezarion at `51190d494` (main) and `eed821254` (PR #1250). Cezarion's sessions ran Squeal 0.1.199, the pinned release (the store's `daemon-token` meta). Sources:
- the live stores of both repositories, opened read-only: cezarion holds 2026-10-14 to 10-18 (25 worktrees), this repository 2026-10-07 to 10-18;
- 780 cezarion Claude Code transcripts from the last 5 days;
- the eval cells of runs `07d7ab` (0.1.199) and `bcdbec` (0.1.215, finished).

Probes: `probes/slow-tier-advisory/` (throwaway, read-only). Nothing was run in a repository and no test or browser ran. The probes ran at a 1-minute load of 4.9 to 19.1 on 24 CPUs and paused once at 25.9.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Reuse in practice | **Across worktrees: large. Within a session: small for build output and browser specs.** Cezarion worktrees hold 614 browser results inherited from another worktree as current, worth about 248 min of runs, beside 815 of their own (293 min). Only 7% of cezarion's 562 revisions re-key no slow file, and 69% re-key all 81 browser specs. Here, 66% of 1,705 revisions re-key no `test/e2e` file, 908 of them docs-only. Eval cells share no store: 0 of 76 inherited anything. | verified by experiment (store and transcript reads) |
| 2 | The transition signal | **Rare, and in feature sessions never a confirmed regression.** Cezarion slow checks: 32 browser `PASS -> FAIL` (14 against the worktree's own pass) and 1 package, against 198 `first observed` (152 of them package files run with no build). 13 of the 14 came from one session that hunted flakes under deliberate CPU burn. In the transcripts read, 3 feature sessions received a browser `PASS -> FAIL`, #1234's `review-gate` among them. Each agent judged its failure unrelated (load, a setup `ENOTEMPTY`, a known flake), and CI passed each on the same head. Sessions did rebuild after a current package pass: 47 to 97 re-runs at a new `dist` key, every one `pass -> pass` at file level. | verified by experiment |
| 3 | Naming affected files without running them | **Declared inputs name everything; tokens name a few and miss.** Declared inputs name 81 of 81 browser specs per source edit, and only 9 of 559 re-runs at a new key changed any outcome (1.6%; here 7 of 359). Tokens plus one-hop importers, on 7 real or synthetic edits: recall 1/1, 1/2, 2/2, 2/2, 8/8 and 0/1, precision 1/1 to 2/14. They missed #1234's one slow failure. Build output: traced closures name 13, 12 and 5 of 17 here and 8 of 13 in cezarion (004-74). For only-slow files, declared inputs are already exact. | verified by experiment, read in source code |
| 4 | Minimum set and text | Named = one-hop importers, plus token evidence, plus slow files failing now. When nothing has evidence, say that the files were re-keyed and that none is named. Today an agent can feed its own run back only through `squeal run --slow` (all pending files) or a named `status --wait` (order only). `squeal run` takes no file. A plain `npm` run is unseen, so the file stays not current. Text proposals are in 4. | read in source code, inferred |
| 5 | What agents do when told | **Evals comply; real sessions do not.** Under 0.1.199's directive ("before you say the task is done, run `squeal run --slow --wait`"), 40 of 40 eval agents ran it. Under 0.1.215's policy-off text, 20 of 36 did: Sol 9 of 9, Sonnet 6, Haiku 3, Luna 2. Under the same 0.1.199 directive in real cezarion sessions, 1 of 98 sessions that edited files ran `run --slow`, 2 ran `run --all`, and 16 ran e2e or package suites through npm. Cezarion's AGENTS.md says the final gate belongs in CI. A smallest eval cell is designed in 5. | verified by experiment (transcript and cell reads) |
| 6 | The options | Recommend **(a)**, with (e)'s naming added as text once 004-73 ships, and not (e)'s "Squeal does not run them". In practice, the idle drain is the only thing that runs slow files in cezarion sessions. (e) would hand that job to agents, who did it in 1 of 98 sessions, and name the files by a signal with recall 0 to 100% per edit. | inferred from 1 to 5 |

## Findings

### 1. Reuse (verified by experiment)

**Across worktrees.** `reuse.mjs` reads each worktree's latest known state per slow file. Each file is valued at its mean single-file run wall time in the store: 1,616 browser runs took 575 min, about 21 s each.

| Store, 18:54 | Inherited, current | Own, current | Inherited, stale or pending |
| --- | --- | --- | --- |
| cezarion browser specs (82 files) | 614 files, 247.5 min | 815 files, 293.0 min | 103 files, 66.8 min |
| cezarion `test:package` (13 files) | 16 files, 2.2 min | 85 files, 16.4 min | 0 |
| Squeal `test/e2e` (fast lane here) | 83 files, 14.8 min | 42 files, 3.7 min | 0 |

These are lower bounds. At 19:00 the store had pruned two finished worktrees, and browser inherited-current was down to 533 (224.6 min). Registration shows the same thing from the agent's side: of 8 Claude sessions whose first `Slow tier:` line was read, 4 started with 7 to 81 slow files already current (`SQUEAL · registered at revision 0`, `baseline.onStart: "lookup-only"`). Eval cells cannot measure this, because each cell has its own store (0 of 76 a2-slow cells show `Inherited`).

**Across edits.** `store-slow.mjs` classifies every revision's changed paths against each group's declared inputs and test directory.
- **Cezarion.** Of 562 revisions, 388 (69%) re-key all 81 browser specs, because their inputs hold `packages/cezar/src/**` and `packages/web/src/**`, test files included. 165 (29%) re-key the package files: `npm run typecheck` rewrites `packages/cezar/dist` (#1234's own friction note sq33: "63, 80, 194, 90 and 182 checks" flipped per typecheck). 38 (7%) re-key nothing, 30 of them docs-only.
- **This repository.** 1,122 of 1,705 revisions (66%) re-key no `test/e2e` file, and 908 are docs-only.

So a stored slow result outlives edits mostly here, and mostly in docs and coordinator worktrees. In cezarion feature work it is re-keyed by almost every edit.

### 2. Transitions (verified by experiment)

Slow-check transitions in the cezarion store (`to-unknown` left out), each with the result before it:

| Group | `PASS -> FAIL`, own pass before | `PASS -> FAIL`, any other result before | `first observed: FAIL` | `FAIL -> PASS` |
| --- | --- | --- | --- | --- |
| browser | 14 | 18 (another worktree's pass 6, its fail 8, own earlier fail 4) | 46 | 26 |
| `test:package` | 0 | 1 (another worktree's pass) | 152 | 104 |

- **The 14.** 13 are the main checkout on 2026-10-14 (transcript `74366d0f`). That session was fixing load flakes from a warmup run and ran 40 CPU burners beside the browser specs on purpose. Its `diff-scroll`, `smoke`, `project-rail` and `tab-coordination` failures fed two flake-fix PRs. The 14th is #1234's `review-gate` (case below).
- **The package 152.** Fresh worktrees with no `dist` (#3, #35), which 004-65's precondition now turns into a skip. The 104 `FAIL -> PASS` are the same files after the agent built.
- **Rebuilds after a current pass did happen.** 47 package re-runs at a new key in the 19:00 store (97 at 18:54) were all `pass -> pass` at file level. No session in the window produced a build-output `PASS -> FAIL` against its own baseline. For one to show up, an agent would need to build after a pass, mid-task, with a change that breaks the built CLI. 004-74 found builds rare and late.
- **This repository's `test/e2e` (fast lane).** 6 `PASS -> FAIL` against an own pass: `stop-gap` ×4 (the flake row 011-20), `lifecycle`, `worktrees`.

`tab-coordination` failed `PASS -> FAIL` in four Claude subagent worktrees (`.claude/worktrees/agent-*`) on 10-14 and 10-15, after other worktrees' results, the same flake each time.

**Feature sessions that got a browser `PASS -> FAIL`.** In the transcripts read, three feature sessions received one. All three agents judged their failure unrelated, and CI passed the spec on the same head:
- `new-task.e2e.ts`, 2026-10-16: `ENOTEMPTY` in its temp directory; retried as environment.
- `task-handoff.e2e.ts`, 2026-10-16: the known flake #795.
- `review-gate.e2e.ts`, #1234: below.

**Case: cezarion #1234, `review-gate.e2e.ts`.** Transcript `-home-agent-projects-cezar--ai-cezar-worktrees-17413271-…/2af0fedd-….jsonl`, Squeal 0.1.199, primer with the before-done directive.
- **Path.** The idle drain. The agent's last tool call before a pause was at 15:54 UTC. While it waited for CI, the slow tier ran 54 browser files. `review-gate` stored its result at 16:12:20 (run `16f2578b`, revision 190). The `PASS -> FAIL` reached the agent with the next prompt, a CI observation, through `UserPromptSubmit` at 16:15:20. No idle wake was seen in between.
- **Not a request.** The agent never ran `squeal run --slow`, `run --all` or an npm browser run in the whole session. Its PR says "The cockpit E2E is left to CI".
- **The baseline.** The same check passed in this worktree at r144 (13:33) and r150 (14:28). It was a true transition against a baseline recorded before the change (r150 to r190: commits `20f935353..3c5ea5957`, the `cezar_ask` split).
- **What it caught.** One of 5 tests failed: "Accept finishes the run as done and fires the one-shot celebration". The `[data-slot="review-accept"]` wait timed out after 25.3 s. The failure bundle's snapshot shows "Run activity · In progress" and no Accept button. `review-panel.tsx` renders the button only when `run.finishBlocked === null`.
- **What the agent did.** It read the bundle, saw that CI passed the spec, and judged it "mid-turn under load". At 16:25 it queued `squeal retry --reason load` (load 4.21). By 18:50 the retry had stored no result, because later edits re-keyed the file. The known state is `fail pending`.
- **Ground truth.** CI's four browser shards passed at `3c5ea5957` (the agent's reading) and at `eed821254` (`gh pr checks 1250`, read 2026-10-18).
- **Real defect or not: not determined.** The Accept button's condition sits next to this PR's subject, finishing a run, which makes it plausible. The CI passes and the agent's load judgement point the other way. The retry's result decides it.
- **Under (e).** Declared inputs would name it as one of 81. The token-and-import advisory (3) names only `worker-relationships.e2e.ts` for r150 to r190, through the token `ask-card`, and 23 of 81 for the whole branch, never `review-gate`. Under (e) Squeal would not have run it, and this agent ran no browser spec, so the failure would not have been seen locally.

### 3. Naming the affected files (verified by experiment)

Ground truth is a re-run at a new key whose outcomes differ from the previous run's (`store-slow.mjs`). This measures which re-keyed files actually changed result, not which ones mattered.

| Signal | Kind | Named | Precision against changed results | Recall |
| --- | --- | --- | --- | --- |
| Declared inputs (what Squeal keys on) | browser | 81 of 81 per source edit | 9 of 559 re-runs (1.6%), 8 of them flakes | everything the inputs see |
| Declared inputs | build output: cezarion package | 13 of 13 per `dist` change | 19 of 97 (missing or stale builds turning to passes) | same |
| Declared inputs | build output: Squeal `test/e2e` | 17 of 17 | 7 of 359 (2%) | same |
| Traced closure (004-74, not built) | build output | 13, 12, 5 of 17 here; 8 of 13 in cezarion | not measured | not measured |
| Declared inputs | only slow (eval fixture) | 1 of 1 | exact | exact |

For browser specs, an advisory needs a signal beyond keys. Here it is scored as a set: one-hop importers, plus D2's token evidence (b2). The first six rows are from `issue-4-signals.md`; the seventh is from `advisory.mjs`.

| Edit | Specs | Named | Wanted named | Precision | Recall |
| --- | --- | --- | --- | --- | --- |
| E1 `markdown.tsx`, #1076 | 76 | 1 | `artifact-project-links` | 1/1 | 1/1 |
| E2 `thread-scroll.ts` | 77 | 1 (one-hop) | `progressive-history`; `thread-scroll` missed | 1/1 | 1/2 |
| E3 helper `github-fixture.ts` | 75 | 7 | both | 2/7 | 2/2 |
| E4 `build-e2e.sh` | 77 | 0 | all are equal | n/a: the advisory must say "all" | n/a |
| E5 `accessibility.css` | 73 | 14 | both | 2/14 | 2/2 |
| E6 `diff.tsx` | 77 | 11 | the 8 | 8/11 | 8/8 |
| #1234, r150 to r190 | 81 | 1 (`worker-relationships`) | `review-gate` missed | 0/1 | 0/1 |

The token signal is a DOM heuristic and recognises nothing in server-only edits. #1234 changed 42 files and 4 of them were in `packages/web`. For server edits and build scripts it names none, while every spec is re-keyed. Cezarion's AGENTS.md already prescribes this method by hand: "No tool maps a cockpit source change to the browser specs it affects … Grep `packages/web/e2e/*.e2e.ts` for the `data-slot` …". The #1234 agent ran that grep (15:52) and reached the same single spec.

### 4. The minimum set and the text (read in source code, inferred)

**Feedback paths today** (`src/cli/run.ts`: `squeal run --all|--fast …`, `squeal run --slow [--wait <ms>]`):
- **`squeal run --slow`.** Runs every pending slow file, stored and keyed.
- **A named `status --wait <ms> <file>`.** Promotes a queued file (011 C15), but "Promotion does not make the slow tier eligible while a consumer is in a turn".
- **`squeal retry <file>`.** Re-runs a failure or a file with no result (011-16).
- **No verb runs one named slow file.**
- **A plain `npm run test:e2e -- <spec>`.** Its result is never stored. The file stays "not run at this revision", and inheritance and `stop.requireSlowSuite` cannot count it. Cezarion's AGENTS.md forbids that duplication while Squeal validates.

**A minimum set (proposal).**
- Name the slow files with evidence for the revisions since the session started: one-hop importers, token evidence (004-73's ranking, still planned), and slow files failing now.
- Cap the list at 5 names plus a count.
- When the changed files give no evidence, say so, never "none affected".

Text in 004-71's register, naming no build command:

```text
Slow tier: 81 test files; your changes re-keyed 81; 1 is named by what it selects: worker-relationships.e2e.ts. Squeal runs them when the agent pauses; `squeal run --slow` runs them now.
Slow tier: 81 test files; your changes re-keyed 81 and name none of them (no slow file selects what the changed files render).
```

At Stop, with `stop.requireSlowSuite` on, the named files are the ones to hold for. A `--slow <path>` filter on `squeal run` would let the agent run just those, stored and keyed. That is a CLI change, not designed here.

### 5. What agents do when told (verified by experiment)

| Where | Squeal and wording | Sessions | Ran the slow files through Squeal | Slow current at the end |
| --- | --- | --- | --- | --- |
| eval a2-slow, `07d7ab` | 0.1.199, "before you say the task is done, run `squeal run --slow --wait`" | 40 | 40 | 39 |
| eval a2-slow, `bcdbec` | 0.1.215, policy off: "not required before you finish" | 36 | 20 (Sol 9, Sonnet 6, Haiku 3, Luna 2, of 9 each) | 26 |
| cezarion, Claude Code, 2026-10-13 to 18 | 0.1.199, the same directive as `07d7ab` | 98 that edited files | 1 `run --slow`, 2 `run --all` | not measured |

In those 98 sessions, 16 ran an e2e or package suite themselves through npm, most of them targeted. 20 received a slow delivery. The gap between 40 of 40 and 1 of 98 is the finding, and three things stand behind it (inferred from the transcripts and AGENTS.md):
- Cezarion's AGENTS.md tells agents that "the final gate and full-suite runs belong in CI" and not to run `squeal run --all`.
- Its Stop policy requires no slow suite.
- Its sessions are long and run inside Cezar workflows that end on CI waits.

An advisory's text alone is unlikely to move these sessions. The idle drain ran the files anyway, and it found #1234's `review-gate` and the 10-14 flakes.

**The smallest eval cell that would measure an advisory** (designed, not run):
- **Fixture.** Ledgerline with 3 slow files. One selects a `data-*` value that the edited module renders. A second is re-keyed but selects nothing. A third is unaffected.
- **Arms.** Squeal's advisory line naming the one file, and 0.1.215's line.
- **Repository instruction in both arms.** The real competing one: "the final gate belongs in CI".
- **Expectations, per situation (scored separately, never pooled).**
  1. The named file is current at the final claim, through Squeal.
  2. No slow-pass claim is made unless the `Slow tier:` line backs it.
  3. The unnamed re-keyed file is not required.
- **Size.** 4 models × 10 repetitions × 2 arms = 80 sessions, about the atomic tier's cost per model. Pin it with two reference sessions, one run and one not run, so the grader is calibrated.
- **Power.** From 0.1.215's 56% baseline, a gap per model needs about 50 points at n = 10 to reach p < 0.05. Pooled across models, 40 against 40 confirms about 30 points.

### 6. The options

| Option | Evidence for | What it loses | Cost to build / maintain |
| --- | --- | --- | --- |
| (a) keep, better wording (004-74) | The idle drain is what ran slow files in practice. The #1234 agent and 97 of 98 others never asked, yet results arrived. 614 inherited browser results serve other worktrees. 004-74 measured no shift in the fast lane's median. | Most re-runs re-confirm a pass (98.4%). In feature sessions, 3 of 3 browser failures were judged flakes or environment. Agents also pay for the triage. | One wording change. Keeps D1 to D10 and their tests. |
| (c) on request plus the finish gate | Matches CI-owned gates. Fewer flaky deliveries. | Every unasked delivery: #1234, the 10-14 flake finds, 2026-10-16's two. Inheritance shrinks to what agents ask for: 3 of 98 sessions. | Deletes the idle trigger and 004-29's exit drain. |
| (e) advisory, Squeal does not run them | Names a few files where tokens exist (E1, E6). States the gap cezarion's AGENTS.md describes. | The same as (c), plus a naming recall of 0/1 on the one real-session catch and 1/2 on E2. For server and build-script edits it names nothing. For build output the names are 5 to 17 of 17 with no measured gain. | Build: 004-73 plus set output, one-hop importers, new D8 text, a `run --slow <path>` verb, the eval cell. Maintain: a DOM-token heuristic (vision filter 4). Deletes D2's idle trigger and exit drain, D3 (explicit runs already skip it), D4's discards for idle runs, and D9's `stop-slow` wait. Keeps D1, D5, D6, D7, D8, D10. |
| (d) exclude the slow suites | The smallest Squeal. | 90+ cezarion slow files go back to the fast lane, or nothing covers them. Agents ran them in 16 of 98 sessions. | Deletes D1 to D10. |

**Can (e) keep `stop.requireSlowSuite` meaningful?** Only if the agent's runs go through Squeal. Stop could then hold for the named minimum set at this revision, which is narrower than today and would have let #1234 finish without `review-gate`. Through npm, Squeal sees nothing, and the key could only trust the agent's word.

## Recommendation for Squeal

Option (a). Keep the idle drain, the explicit triggers and the shared store's inheritance. Fold in two additions:
1. When 004-73 ships, the `Slow tier:` line names up to 5 files with evidence, and says when it names none. This is text only; it adds no trigger and removes none.
2. In the CLI design queue: `squeal run --slow <path>...`, so an agent who acts on the names stores a keyed result rather than an unseen npm run.

The tradeoff that decides it is who runs the slow files when nobody asks. In 97 of 98 real cezarion sessions nobody asked, and the idle drain ran them. (e) moves that job to the agent, and on this evidence the job would mostly not get done. (e) would delete about D2's idle half, D3, D4's idle discards and D9's wait, and lose the unasked deliveries and most cross-worktree reuse.

The human's doubt about value holds in one respect. 98.4% of slow re-runs re-confirm a pass, and every feature-session failure in the window was judged a flake. The slow tier's measured value is coverage nobody asked for, not regressions caught. Whether that coverage is worth its flake triage is the human's call. The numbers are in 2.

## Open questions

1. Whether #1234's `review-gate` failure was real. The pending `squeal retry` (or a re-run at `3c5ea5957`) decides it. The human's report that it "proved helpful" is not reflected in the transcript, where the agent treated it as load.
2. Codex sessions on cezarion were not read. Their run and ask rates may differ from Claude's 1 of 98.
3. Precision is measured against outcome changes, most of them flakes. Whether a named file would have caught a real regression has no case in the window: no feature session had a confirmed slow regression.
4. The token signal's recall was measured on 7 edits, all from cezarion, with one person's choice of "wanted" (`issue-4-signals.md` open question 1).
5. Traced closures for build output were not scored against outcome changes, because no build-output result changed in 004-74's probes.
6. The stores prune finished worktrees: two went between two reads 6 minutes apart. Reuse figures are lower bounds for the window.

## Sources

- Squeal `06cc5da0`:
  - `src/cli/run.ts:34` (usage), `src/cli/status-wait-slow.ts`
  - spec 004 D1 to D10, 011 C4 step 4, C6 and C15
  - `slow-tier-role.md`, `issue-4-signals.md`, `probes/issue-4-signals/tokens.mjs` and `logs/signals.json`, `probes/slow-tier-role/a2-tally.sh`
  - `docs/board.md` rows 004-72 to 004-75
- Cezarion: `squeal.config.json` and `AGENTS.md` at `51190d494` (lines 212 to 293); PR hearsay-tools/cezarion#1250 (`gh pr checks 1250`, `gh pr view 1250`, 2026-10-18); commits `4f2f01c0..3c5ea5957` and `51190d494..eed821254`; `packages/web/src/routes/task-thread/review-panel.tsx` at `eed821254`; failure bundle `.ai/qa/failures/review-gate/Accept-finishes-…-1/` in worktree `17413271`.
- Stores, read-only: `/home/agent/projects/cezar/.git/squeal/store.sqlite` (read 18:54 and 19:00 CEST), `/home/agent/projects/squeal/.git/squeal/store.sqlite`.
- Transcripts, read-only: `~/.claude/projects/-home-agent-projects-cezar*/*.jsonl`, the last 5 days. The #1234 session is `…worktrees-17413271-a7d9-491e-b190-b16533f7e987/2af0fedd-c789-442a-a61a-c56c7d32fc71.jsonl`; the others are named in 2.
- Eval cells, read-only: `/tmp/squeal-evals-1001/cells/e77eff42453e/20261016T061730Z-07d7ab/a2-slow*`, `…/581f1772dc45/20261018T125937Z-bcdbec/a2-slow*`.
- Probes and logs: `probes/slow-tier-advisory/README.md`.
