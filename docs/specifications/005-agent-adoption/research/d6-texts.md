# D6 texts: where each item holds (005-15)

Board row 005-15, worker 80d080b5, 2026-10-13, on `5378abd3` (0.1.142). Survey, then finish: each D6 item against the primer (`src/harness/shared/primer.ts`) and `skills/squeal` as they stood, then only what was missing. Builds on 001-283 (`../../001-core-loop/research/primer-skill-writing.md`); nothing of it was redone.

## The table

| D6 item | Already held by | Missing before 005-15 | Changed in |
|---|---|---|---|
| 1. The references name D2's path form, for a test the agent did not edit; the primer does not change for it | 005-11: `commands.md` documents `status --wait <ms> <path>...`, its verdict line and exit codes | Why an agent would use it: the plain wait holds only for files its edits re-keyed | `commands.md`: "such as a test file your edits did not re-key, which the wait above does not hold for" |
| 2. Checkpoint and status units follow D1 | 005-10: `commands.md`'s `run --all --wait` paragraph (verdict first, exits 0/1/3, tests and test files that did not load counted apart) | `status` and headers count tests and file-level checks apart only after 005-21 | Nothing here. After 005-21 lands: `commands.md`'s `squeal status` example (`Affected checks: 47 passed, 3 running, 12 queued`) and `reports.md`'s header example take its units |
| 3. The primer says passing results are silent and a message means a check changed | The skill (intro "reports only changes", step 1 "No message means nothing changed"); 001-224's first-edit line ("passing ones stay silent") | The primer, the only surface every session reads | Primer, first sentence: "a SQUEAL message with your next tool call means a check changed, and passing results stay silent, so keep working" |
| 4. The skill says a new failure is re-run once by Squeal (001-171), so the agent waits for it | `policy.md` mentions a pending re-run only under Stop's block | The step an agent on a FAIL reads | `SKILL.md` step 2: the re-run, its exceptions (slow files, more than eight new at once), the `Flaky: FAIL -> PASS under the same inputs` line, "let that re-run answer" |
| 5. Revisions defined once, in the primer, in the human's words | Nothing; `reports.md` had its own definition ("Squeal's counter of workspace changes") | The primer sentence; and a second definition to remove | Primer: the human's sentence verbatim, before the coverage list. `reports.md`'s bullet now points at the primer, keeps "not a git commit" and says the header's file list names what moved it |
| 6. `squeal why`'s `Changed since revision N:` line | 001-225 (0.1.100), reached from every FAIL report's last line | `commands.md` did not say what the line means | `commands.md`, `squeal why`: the line, its cap (20 paths, 20 revisions each), absent at the current revision |
| 7. Reassurance event-driven: (a) settled line, (b) a quiet wait naming a running checkpoint, (c) the first-edit line | (a) 001-223, (b) 001-217, (c) 001-224 | Nothing D6 asks | None. The delivery lines speak for themselves; `reports.md` does not gloss them (left out on purpose, so nothing is said twice) |
| 8. The primer stays the main surface | 001-283's split (every must-have step in the primer) | Nothing | None |
| 9. Every text change keeps the 10,000-character cap; measured in the proof sessions, not assumed | `withPrimer` caps registration plus primer at `MESSAGE_CAP_CHARS` | Measurement is 005-18 / 006 | Nothing; see "For the next measurement" |

The human's 2026-10-12 split, the wording around 001-292's coverage: the quoted phrases ("new matching files are picked up", "anything else the repository checks is yours to run") were from 001-292's file-rules plan, which the human replaced with C1, the uncovered-edit line (`src/harness/shared/uncovered-edit.ts`: "No result for <paths>: no test Squeal runs reads it. Run whatever tests it yourself."). Neither phrase was ever in the code. Taken into `SKILL.md`: the intro says a test file the agent adds that matches is picked up too, and "Typecheck, build and anything else the repository checks are yours to run"; step 5 names the `No result for <path>` line as one more case of running tests yourself. The primer's closing sentence (001-234) is unchanged: it is what luna a5 is measured on, and 001-308 found primer wording did not move luna there.

## Luna's `unknown` after a quiet line naming `run --slow --wait`

Which line: the first line of a quiet `status --wait`, built by `slowTierText` in `src/cli/status-wait-lines.ts` (001-282): "...; 1 slow file is not current, which this wait does not hold for: `<cli> run --slow --wait 60000` runs and waits for it". Not one of 005-15's files.

What the results say (every `a2-slow` luna cell in `evals/results/*.atomic*.json`):

| Run | Squeal | `unknown`, no `run --slow` | `fail` after `run --slow` | `unknown` after `run --slow` |
|---|---|---|---|---|
| 6eec71 | 0.1.127 | 11 | 9 | 0 |
| 257eaf | 0.1.127 | 6 | 4 | 0 |
| 3f2edd | 0.1.131 | 0 | 10 | 0 |
| ae0c65 (p0 + stop-slow) | 0.1.131 | 0 | 16 | 4 (load spikes, 006 `lessons.md`) |

All 17 claims were on 0.1.127, each after one wait and no `run --slow`, quoting "N queued, slow test pending". 0.1.127 is before 001-283 (0.1.128), which put the slow step into the primer ("before you say the task is done, run `... run --slow --wait 60000` unless the header's `Slow tier:` line says every slow file is current") and into `SKILL.md` step 4, and before step 4's "When a check stays pending after you waited again" replaced the pending fallback that let a single wait end in "unknown". From 0.1.131, luna ran `run --slow` in 30 of 30 sessions and no `unknown` came without it.

Proposal: no change to the quiet line. The behaviour it was blamed for has not recurred since the primer's slow step landed; a reworded quiet line would be measured against a 0 of 30 baseline. If a later run shows it again, the candidate is to lead the clause with the action ("run `<cli> run --slow --wait 60000` before a claim: 1 slow file is not current and this wait does not hold for it"), owned by 001 (`status-wait-lines.ts`), measured on `a2-slow` luna.

## Lengths

The primer's cap is 1,500 characters; past it, `primer()` folds node:test projects first, then names the CLI less. D6's revision sentence is 173 characters, so the room before folding shrank.

| Primer | Before | After |
|---|---|---|
| Claude Code, Vitest only | 607 | 809 |
| Claude Code, slow files | 1,032 | 1,217 |
| Codex (56-character plugin root), slow files | 1,194 | 1,379 |
| Codex, Vitest, two node:test projects, slow files (the 001-234 matrix) | 1,305 | 1,490 |

The last row is 10 characters under the fold. A Codex plugin root about 5 characters longer than the tests' (`/home/someone/.codex/plugins/cache/squeal/squeal/0.1.107`, 56) folds the second project to "and 1 more"; the "not covered" sentence stays whole, as 001-234 designed. To fit, the first sentence carries "passes are silent" (+30 characters) rather than eval variant `p1`'s separate sentence (+118), and the slow step drops "already" and "their results" ("waits for them").

## For the next worker and the coordinator

- Bundles: `plugins/*/dist` inline the primer, so `test/harness/plugin.test.ts` and `test/harness/codex/plugin.test.ts` "committed exactly as the build produces them" fail until the coordinator rebuilds.
- `evals/variants/p1.json` inserts D6's two sentences after the run-tests-yourself sentence. Its `find` still matches the shipped primer, so a `p1` run now carries the revision sentence twice and a second "passes are silent". Retire it, or rebase it as a new variant.
- 001 D9's primer text and 004 D8's slow sentence quote the old wording; the coordinator's to amend.
- After 005-21: the `squeal status` and header examples in `commands.md` and `reports.md` (item 2).
- `commands.md` is 9,855 characters. No test caps a reference file, but it is the longest.
- The model-facing text changed, so the next 006 baseline is a new trend point; luna a5's false passes must stay at or under 3 of 10 (`TREND.md`).
