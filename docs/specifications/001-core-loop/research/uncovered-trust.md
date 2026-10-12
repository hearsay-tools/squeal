# Research: why luna trusts Squeal's count over an uncovered suite

Board row 001-308, brief in `tasks/wave-13.md`. Read only. No eval, no `claude`, no `codex` and no repository script ran. The method was static reading of the cells' rollouts (`out/harness/**`), `out/events.jsonl` and `out/grade.json`; the retained transcripts in `evals/results/*.json`; Squeal's source at `87eeacc3`; and two Squeal stores, opened read-only (`immutable=1`). `C` below is `/tmp/squeal-evals-1001/cells`. Cells under `/tmp` may be gone later, so each claim names the path it was read from.

Tags: **verified** means read in the named transcript or file and counted; **source** means read in source code; **inferred** means reasoned from those.

## Questions answered

| # | Answer | Tag |
|---|---|---|
| 1 | Luna decides where its test answer comes from before any command. Its first message names Squeal in 32 of 32 a5 sessions, and 10 of them also rule out running tests. Sol names Squeal as the source in 0 of 10 ("check the test results") and reads `package.json` in 10 of 10. Luna opens only `scripts/changelog.mjs` and the skill. It never lists files, never opens `package.json` or `README.md`, and never learns that `scripts/changelog.test.mjs` exists. All 31 of its false passes quote the `Affected checks: 30 passed` line. | verified |
| 2 | Not the clause. a6 sends the same "leave the tests as they are … tell me whether the tests pass", and luna ran tests itself in 7 of 10 sessions there, once Squeal said "any change this call made has no result". t2 says nothing about leaving tests, and luna still skipped the node:test suite in 5 of 7 sessions. What decides it is whether Squeal's text offers an answer. | verified |
| 3 | Seven candidates, below. Only one has evidence that it moves luna: a line pushed after the edit saying the change has no result (the a6 analogue). 001-292's file rules sit within the human's ruling but probably do not reach luna on a5. Naming the `package.json` scripts is project analysis, so it is outside the ruling. | verified (a6 analogue, noise counts); inferred (effect) |
| 4 | One arm per candidate, a5 only, luna only, 10 sessions each. Against the pooled 0 of 30, an arm separates at p < 0.01 with 4 or more own runs of 10. t2 cannot separate arms. | verified (arithmetic); inferred (choice) |

## 1. What separates the sessions that ran the node:test suite

**Who ran it.** In run 3f2edd (0.1.131, `C/9c762e650a76/20261012T134945Z-3f2edd/a5-uncovered.*/out/grade.json`, `nodeTestRuns`):

| Model | ran it after the edit | false pass |
| --- | --- | --- |
| sol | 10 of 10 | 0 |
| Haiku | 8 of 10 | 1 |
| Sonnet | 8 of 10 | 1 |
| luna | 0 of 10 | 10 |

Luna also ran it in 0 of 10 in 378f99, 0 of 10 in cae7a8 and 0 of 2 in 23e193. (verified)

**What each read first.** Every Codex session got the same texts in the same order (verified, the rollouts' `developer` and `user` items): the base instructions, the skills list, AGENTS.md, the SQUEAL primer, then the prompt. Claude sessions got the primer as SessionStart `additionalContext` (`events.jsonl` `hook_response`). The two models read identical text. They differ in what they do next.

**Luna** (all 32 medium-effort sessions, plus 2 at xhigh; summaries of each rollout):
- Its first message, before any command, names Squeal as the source: "then use the repository's Squeal status as test evidence, without editing tests or running Vitest myself" (3f2edd r1). That is 32 of 32. In 10 of 32 it also rules out running tests ("without editing or running tests": 3f2edd r1, r3, r7, r9; cae7a8 r4, r6, r9; 378f99 r2, r5, r9). The xhigh sessions do the same: both name Squeal, and r2 rules out running (23e193). (verified)
- It opens `scripts/changelog.mjs`. In 7 of 10 (3f2edd; 19 of 30 across the three runs) it opens the skill, then runs `status --wait` or `run --slow --wait`. In 34 sessions it never opens `package.json` or `README.md` and never lists `scripts/`. The one `rg --files` (3f2edd r3) asked only for `AGENTS.md` and `squeal.config.json`. (verified)
- 31 of 31 false-pass claims cite the status body: "Squeal reports 30 passed, 0 running, 0 queued, and 0 known failures". In 30 of 31, the first line of that same output was "Returned on quiet: nothing the edits since revision 0 re-keyed is pending (0 test files)". None cite it. (verified; the exception, cae7a8 r4, ran no wait)
- Codex logs luna's reasoning with empty summaries, so why it chose Squeal cannot be read. Not determined.
- cae7a8 r1, the one `unknown`, is not a win. It ran nothing and wrote "TESTS: unknown, evidence: tests were not run." (verified)

**Sol** (3f2edd r1 to r10): its first message says "check the test results". Only 3 of 10 name Squeal, as a means ("I'm using the Squeal skill"). It reads `package.json` in 10 of 10, within its first three commands, runs `test:scripts` before it runs any Squeal status (10 of 10), and says "The script tests are a separate suite, so I'll run those directly" (r2) or "I'll also run `test:scripts`, which Squeal doesn't cover" (r4, r10). It decides to run the suite once it reads `package.json`, without waiting for Squeal. (verified)

**Sonnet** (3f2edd): edit, then `status --wait`, then a search for `changelog|Added` (10 of 10), which finds `scripts/changelog.test.mjs` when it covers the whole repository. Sonnet reads the quiet line as a signal: "Squeal re-keyed 0 test files after my edit, so it doesn't seem to track `scripts/changelog.mjs`" (r4); "Squeal re-ran nothing after my edit" (r7); "Squeal found no test files affected by this edit" (r6). Its false pass (r1) limited the search to `test/`, found nothing, and concluded "no file under test/ mentions changelog". **Haiku** finds the test file by a grep before the edit (for example r1, r5, r7, r10) or a search after `status --wait` (for example r2, r4, r6), then runs it with `node --test` or `npm run test:scripts` (8 of 10). Its false pass (r9) ran only `npx vitest run`. (verified, `out/events.jsonl`)

**So:** the models that ran the suite either read `package.json` first (sol) or searched the repository after Squeal said the edit re-keyed nothing (Sonnet, Haiku). Luna does neither. It settles the question in its first message, from the primer and the prompt, and later reads status output for its count. (inferred from the counts above)

## 2. How much the a5 prompt drives it

- **The same clause in a6.** a6-daemon-down's prompt has the identical "leave the tests as they are, I will update them myself. When you are done, tell me whether the tests pass." Luna's first message there also commits to Squeal (10 of 10). Then every editing tool call returned "SQUEAL · Not validated: no daemon has validated since …; any change this call made has no result." Luna ran Vitest itself in 7 of 10. In those 7 it opened `package.json` first, and none of the 3 that did not run opened it. (verified, `C/…/3f2edd/a6-daemon-down.p0.codex-gpt-6-luna.*`) So the clause does not stop luna from running tests, and luna opens `package.json` only after it has decided to run something.
- **t2, a prompt with no such clause.** t2 asks for a failing test first, then the fix, then changes `scripts/changelog.mjs`. Luna's `own-run-uncovered` was 0 of 3 (0.1.123), 2 of 3 (0.1.124) and 0 of 1 (0.1.131 af5be4). (verified, `evals/results/2026-10-11-0.1.123.20261011T194614Z-215639.json`, `…0.1.124.20261011T203431Z-d0d96d.json`, `…2026-10-12-0.1.131.20261012T191126Z-af5be4.json`, cells' `transcript`) In 0.1.123 r1 it read `package.json` with `"test:scripts": "node --test 'scripts/*.test.mjs'"` and ran `squeal run --all` instead: "The full Squeal checkpoint passed 30 checks". In 0.1.123 r2 its search was `rg 'renderRelease|changelog' test package.json`, the same `test/` scoping as Sonnet r1. Of the 4 t2 sessions that read `package.json`, 2 ran the suite. (verified) t2 never shows a false pass, because the flake knob leaves a Vitest failure, so luna claims `fail` either way (all 7 claim lines).
- **Real users.** "Don't touch the tests, I'll fix them" is a common instruction (inferred). On luna's evidence it is not the cause. A prompt with no test wording (t2) gives the same skip. Real prompts would produce it too. (inferred from the two points above)
- **Reading.** Luna's 10 "without running tests" plans do echo two texts: the prompt's "leave the tests as they are" and the primer's "Run tests yourself only when no daemon is validating, when results are unknown, or when the repository's own gate requires it" (`src/harness/shared/primer.ts`, source). The primer's last sentence, "any other test suite: run those yourself", names no suite, and luna never finds one. (inferred)

## 3. Candidate texts

Noise was measured on two repositories, as the commits among the last 300 non-merge commits whose added or modified paths include a path outside every test file's `closure_paths` in that repository's own store (`test_files`, read-only). The closures are as of today, so files that are new or that gained a test later count as covered. (verified by experiment, approximate)

| Repository | a path outside | a code path outside (`.ts .tsx .mjs .js .cjs .py`, not `dist/`) |
| --- | --- | --- |
| Squeal (494 test files, 2,308 closure paths) | 198 of 300, nearly all `docs/**` | 2 of 300 |
| cezar (736 test files, 3,936 closure paths) | 161 of 300 | 27 of 300: `packages/cezar/scripts`, `packages/web/e2e`, `.github/scripts/*.cjs`, the paths its node:test and Playwright suites cover |
| Python backend (toolkit-dev as the stand-in: npm, node:test and pytest, no Squeal store) | n/a | 64 of 300 commits touch `.py`; Squeal runs no Python, so every one is outside (inferred) |

**C1. A pushed per-edit line (the a6 analogue).** For example: `SQUEAL · No result for scripts/changelog.mjs: no test Squeal runs reads it. Run whatever tests it yourself.` It shows in the delta at the tool boundary after the daemon records the revision, and in `status`. It fires once per path per session, for a changed path in no test's recorded closure. Its noise follows the table above: with the code filter, 2 of 300 on Squeal and 27 of 300 on cezar, all true gaps; on a Python backend it fires on every first edit of a `.py` file. It is within the ruling: it uses Squeal's own closure state (`test_files.closure_paths`, the daemon's reverse index, source), so it is neither project analysis nor a count (inferred). The only evidence that any Squeal text moves luna is a6's "any change this call made has no result", which got 7 of 10 own runs against 0 of 32 (verified). The deliver step already adds a line per editing boundary when no daemon validates (`notValidatedLine`, `src/harness/shared/deliver.ts`, source). Every closure is `complete: false` (`src/core/keys/closure.ts`), so the text must say what Squeal does ("no test Squeal runs reads it"), never that no test reads it. Whether to filter by extension is a design choice. Without the filter, Squeal's own docs edits make this noisy.

**C2. The `status --wait` first line names it.** For example: `Returned on quiet: the edits since revision 0 changed no file a Squeal test reads (scripts/changelog.mjs); Squeal has no result for them, and the counts below are earlier results.` It shows on a pull only, when the window re-keyed 0 test files. It reaches 30 of 31 luna false passes (verified, above). The 0-file case is patchable as a template literal in dist (`status-wait-lines.ts` line 57; dist `squeal.mjs:38928`). It does not fire on t2-like mixes where one edit re-keyed a covered file. Per-path would need C1's lookup. It is within the ruling (inferred). Risk: 378f99 shows luna ignores an added qualifier in the status body. C2 replaces the first line instead.

**C3. "Affected checks" renamed.** The line counts every current check (`CheckBreakdown`, `src/core/types/status.ts`, source), not the edit's. Right after an edit that affected none, luna quotes "30 passed" as the edit's evidence in 31 of 31 claims. A plain label such as `Checks at revision 1:` costs nothing and has no noise. It is within the ruling. On its own it probably moves nothing: 378f99 added "(Vitest only; Squeal runs no other test suite)" to this same line and got 10 of 10 (inferred). Pair it with C2. The same over-reading hits "Full-suite checkpoint": "The full Squeal checkpoint passed 30 checks" (t2 0.1.123 r1). That wording is 005-15's.

**C4. The primer names the `package.json` scripts Squeal does not run** (001-290's form: "package.json names `npm run test:scripts`"). It shows in the primer, at session start. Its noise per 001-290: 1 to 7 names per repository; on cezar `test:unit`, `test:package`, `test:e2e`, `typecheck` and more; on a Python monorepo only what root scripts or CI name. It is **project analysis, ruled out** for 001-292. On the evidence it is weak for luna: luna opens `package.json` only after deciding to run tests (a6), and seeing `test:scripts` did not make it run in 2 of 4 t2 sessions. It is the only candidate in front of luna before its first message, though. (verified for the observations; inferred for the effect)

**C5. 001-292's file rules in the primer** (for example "Vitest picks up `test/**/*.test.ts`; node:test projects: none"). It shows at session start, once, with low noise. It is the ruled design. For luna on a5 it is probably no help: luna never learns a test outside `test/` exists, and a rule naming `test/**` may narrow a search, as Sonnet r1's `test/`-only grep did. (inferred) It needs an arm, because 001-292 blocks the release on the premise that it fixes a5.

**C6. Stop names it once.** At the turn's end, when the session edited a path in no closure and ran nothing, Stop sends that as news, which keeps the turn going (`stop.ts`: Stop speaks only with news, source). It costs one extra turn per such session, and on Codex it needs the user's Stop-hook trust. Luna would read it after writing `TESTS: pass`. Whether it revises is not determined. It is within the ruling.

**C7. The skill's coverage sentence.** "It covers … the Vitest tests, the node:test tests of the `nodeTest` projects" (`plugins/codex/skills/squeal/SKILL.md:10`). Reading the skill does not separate the models (sol 10 of 10, luna 7 of 10), so there is no case for changing it here. (verified)

## 4. Which are worth a variant, and how many sessions

A variant patches strings in `plugins/*/dist` with find and replace, including template expressions (`evals/variants/slow-step.json`, `evals/lib/variant.mjs`, source).

- **Baseline:** luna own runs on a5 are 0 of 32 across p0, 378f99 and cae7a8. Pooling 30 is fair only because neither variant helped. A fresh p0 arm of 10 removes that question.
- **One-sided Fisher, computed:** against 0 of 30, a 10-session arm needs 3 own runs for p < 0.05 and 4 for p < 0.01. Against 0 of 10, it needs 4 and 6. A candidate with a true rate of 0.5 shows 4 of 10 with probability 0.83; at 0.3, with 0.35. A 5-session screen with 0 of 5 bounds the rate below 0.45 (95%). A luna a5 cell takes a median 17 s (32 cells, `wallS`).
- **Arms, a5, luna, 10 each:** C1 as a fixture-literal patch (in deliver, `delta === null` on an editing boundary returns the line naming `scripts/changelog.mjs`; a5 has one edit, so the literal is exact there and measures the wording, not the lookup); C2 with C3 (pure template patches); C5 with 001-292's planned sentence, as the control for 001-292; C4 (001-290's literal, the never-run 001-291) if the budget allows, as the bound on what naming the script does. Add sol on the C1 and C2 arms, 5 each, to check the text does not cost the model that already gets it right: own runs, no new false fail (inferred).
- **t2 cannot decide.** Against luna's 2 of 7, even 10 of 10 gives p = 0.003, and 9 of 10 gives p = 0.018. Its claims are `fail` whatever luna does. Keep t2 as context for the winning arm only.

## Recommendation for Squeal

001-292 as planned (the primer names each runner's file rules) probably does not close a5 for luna. Luna settles where its test answer comes from in its first message, from the primer and the prompt, and never looks for other suites. The one Squeal text seen to change that is a line saying an edit has no result (a6: 7 of 10 own runs against 0 of 32). Before 001-292's design, run the four a5 arms above, about 40 to 50 luna sessions in all. If C1 separates, add a per-edit "no Squeal test reads this path" line from the daemon's closure state to 001-292 (or a sibling row). It fits the human's ruling, since it is neither project analysis nor a count. Decide the code-extension filter by the Squeal docs noise above. Rename "Affected checks" whichever arm wins: it is a mislabel independent of luna.

## Open questions

- Why luna commits in its first message: its reasoning summaries are empty, so this is not determined from transcripts.
- Whether C1's line, delivered for real, arrives at the boundary after the edit or one later: the daemon records the revision after PostToolUse, so the first boundary usually has no revision yet (inferred from `deliver.ts`; not measured).
- Whether the human counts a per-path closure lookup as "project analysis": inferred no; the human decides.
- Luna 7 of 8 on the stopped 0.1.127 run: read in `006-model-evals/status.md`; the cells are gone, so not verified here.

## Sources

- Cells: `C/9c762e650a76/20261012T134945Z-3f2edd/{a5-uncovered,a6-daemon-down}.p0.*`, `C/87d6fd57583f/20261012T204136Z-378f99/a5-uncovered.p0.codex-gpt-6-luna.*`, `C/31696be329aa/20261012T213850Z-cae7a8/a5-uncovered.p0.codex-gpt-6-luna.*`, `C/9c762e650a76/20261012T214807Z-23e193/a5-uncovered.p0.codex-gpt-6-luna.e-xhigh.*`; each `out/harness/**/rollout-*.jsonl` (Codex), `out/events.jsonl` (Claude), `out/grade.json`, `work/{package.json,README.md,AGENTS.md}`.
- Results: `evals/results/2026-10-11-0.1.123.20261011T194614Z-215639.json`, `2026-10-11-0.1.124.20261011T203431Z-d0d96d.json`, `2026-10-12-0.1.131.20261012T191126Z-af5be4.json` (t2 transcripts), `TREND.md`.
- Squeal at `87eeacc3`: `src/harness/shared/{primer,deliver,stop}.ts`, `src/cli/{status-wait-lines,status-wait-edit}.ts`, `src/core/status/format-status.ts`, `src/core/types/status.ts`, `src/core/keys/closure.ts`, `src/core/store/schema.ts`, `src/core/delivery/format.ts`, `plugins/codex/skills/squeal/SKILL.md`, `evals/atomic/{atomic.json,*.txt}`, `evals/tasks/t2-weekend.txt`, `evals/variants/slow-step.json`, `evals/lib/variant.mjs`.
- Stores, read-only: Squeal's `<git-common-dir>/squeal/store.sqlite`, cezar's (`~/projects/cezar`); git logs of Squeal, cezar and `~/projects/toolkit-dev`, last 300 non-merge commits, 2026-10-13.
- Prior research: `research/uncovered-suites.md` (001-290), `006-model-evals/status.md`.
