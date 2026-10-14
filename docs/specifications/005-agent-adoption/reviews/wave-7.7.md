# Wave 7.7: short review of 005-60 (005-61)

## Verification output

Initial findings written 2026-10-14 12:23:07 UTC, within 10 minutes of starting. Extended 2026-10-14 12:39:01 UTC with the completed independent suite output.

Fix: `c8d5d54d2af46b3a255da1c6bd91a0f14a0121ac`. Reviewed bundle: `1a6b14f0`, version 0.1.167. Initial checkout: clean `1d662bfc09af68f986322f0e21ada3ae7c44fa5f`, the documentation overlay expressly named by the brief. Its only difference from the bundle is the 005-61 brief in `tasks/wave-7.md`. No unexpected candidate mismatch. Detached at the exact bundle before installation, checks and probes; the branch was restored to `1d662bfc` after the suite, before committing this file.

```text
$ git rev-parse HEAD
1a6b14f0b39d399b141e2d805bc9336124d94727
$ git status --short
[no output before checks]
$ git diff --exit-code 1a6b14f0 1d662bfc -- src test plugins package.json package-lock.json
[no output; exit 0]
$ npm ci

added 58 packages, and audited 59 packages in 6s

19 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
[exit 0]
$ npm run lint
> squeal@0.1.167 lint
> biome check .

Checked 1067 files in 3s. No fixes applied.
[exit 0]
$ npm run typecheck
> squeal@0.1.167 typecheck
> tsc --noEmit
[exit 0]
$ npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/aab4469d-14df-4b19-98aa-771ebf490837

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/aab4469d-14df-4b19-98aa-771ebf490837/test/fixtures/scheduler/.tmp/6bfaf91f-6615-425f-ba6c-8ecc6b9ec0e7/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/aab4469d-14df-4b19-98aa-771ebf490837/test/fixtures/scheduler/.tmp/55826a2e-56d4-4519-9a32-889d41177ca2/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 3610319
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  497 passed | 1 skipped (498)
      Tests  4197 passed | 10 skipped (4207)
   Start at  14:20:47
   Duration  1065.03s (tests 97%, import 2%, transform 1%)

    Isolate  498 workers spawned · ~242ms startup each (spawn + environment, per file)
             at least ~29.93s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

`npm run build` is deliberately omitted: the explicit 005-61 rules say “Don't run `npm run build`.” The real-CLI file is read only, as required; it is not executed. No model session, real `claude` or `codex`, or command as `squeal-e2e` is run. The normal Vitest config selects `.test.ts` files, not `test/real-cli/setup.real.ts`.

Lint/typecheck and the discriminating probes completed on the clean exact bundle. The full suite started there too, but this requested early report is now the sole worktree addition. Its completion therefore carries a documentation-only dirty-tree qualification and is **unverified** as strictly clean-tree evidence under /reviewer. That qualification is not a wave finding.

The independent run reported two scratch-worktree repair diagnostics, cleanup of one earlier-run process, and three experimental type-checking notices. None failed the run. Squeal separately reported timeouts in unchanged eval/watcher tests at host load 92 to 143; all three later recovered under the same inputs. Those background results are not substituted for the independent suite. No timeout or failure was reported by the independent run.

Disposable probes use both committed `plugins/*/dist/cli/squeal.mjs` files and the public source `setupCommand` with an injected terminal asker. Scratch committed repositories contain three gate lines: a plain `npm test` instruction, an `npx vitest run` instruction, and 005-59 N2 (`Use npm test in the README.`, with its code span). All setup applications disable warm-up and trust; the environment has a scratch HOME and system-only PATH. No harness executable is present. Every byte of the instruction file is checked against either its original text or exactly one selected plan proposal. The interactive probe checks every original/proposed pair and the entire numbered choice tail, then selects reword for only the second line. Scratch repositories and the throwaway probe script were deleted before committing. During the suite and after restoring the branch, the report was the only worktree addition.

```text
$ node --import tsx /tmp/005-61-probe.mjs
claude-code: --yes preserves all 3 gate lines, including 005-59 N2; each reports kept
claude-code: explicit reword writes exactly the selected plan line; other 2 remain byte-identical
codex: --yes preserves all 3 gate lines, including 005-59 N2; each reports kept
codex: explicit reword writes exactly the selected plan line; other 2 remain byte-identical
interactive: all 3 proposals shown; keep is choice 1, reword choice 2; selecting reword changes only line 4
PASS: 5 setup applications, both shipped bundles plus injected-terminal source flow; no harness or model launched
[exit 0]
$ cmp plugins/claude-code/skills/setup/SKILL.md plugins/codex/skills/setup/SKILL.md
[no output; exit 0]
```

## Verdict

**PASS: 0 blockers, 0 should-fix, 0 nits.** Exactly one independent capped full suite completed with exit 0; its documentation-only dirty-tree qualification is recorded above. Every named review check holds in source and the discriminating probes. The prior gate-classification residuals are deliberately deferred by the human to 005-62; this row changes the default, not detection.

## Blockers

None.

## Should-fix

None within 005-61's scope.

## Nits

None.

## What fits

- **Default and output.** `src/cli/setup/questions.ts:103` starts with explicit gate answers, then asks for every unanswered proposed gate. The changed `false` at line 108 makes choices `keep, reword`, and pick index 0 records keep. `defaultPick` always returns 0 and prints the choice taken. `flow.ts:96` passes all gate answers once, on the first apply call; `apply.ts:229` prints `kept gate line <id>` for each keep. Both shipped bundles preserve all three fixture lines without any `--gate` flag and report all three kept. Even the known N2 false proposal is not written unseen.
- **Explicit choice.** The skip condition at `questions.ts:105` leaves a supplied `<id>=reword` intact while every other unanswered gate still defaults to keep. `apply.ts:220` filters only explicit reword selections into `rewordGates`. Both shipped bundles write exactly line 4's proposal, retain lines 3 and 5 byte-for-byte, and report those lines kept. The existing flow test at `setup-flow.test.ts:160` also selects reword alongside `--yes` and no harness.
- **Interactive question.** Original text and proposed text are both still displayed, followed by `1. keep (default)` and `2. reword`. The injected-terminal probe validates this for all three lines, accepts the named reword answer for one, and preserves the other two on Enter. The changed EOF test checks the complete original instruction file; it catches a silent default reword.
- **D5, skill, tests.** D5 at `spec.md:134` says keep is the question default and unqualified `--yes` rewords none. Both identical setup skill copies obtain the actual numbered questions first (`SKILL.md:14`), honor a previously requested default (`:15`), and apply one gate flag per answer (`:16`, `:22`). They contain no conflicting reword default. The changed `--yes` flow test at `setup-flow.test.ts:99` requires the kept message and original `VITEST_GATE`; block insertion remains separately checked. The spec's “with every choice” end-to-end statement allows explicit reword flags.
- **Real-CLI expectation remains meaningful.** `test/real-cli/setup.real.ts:213` checks the actual instruction file against `gate.proposed` only when the fixture supplies that id's reword flag; otherwise it requires `gate.text`. The Squeal shape explicitly supplies `CLAUDE.md:3=reword` (`:109`), and its fixture contains that gate, so that branch still proves rewording rather than accepting arbitrary output. The alternate fixture supplies no gate flag; `cezarionShaped` currently creates no instruction-file gate, so its loop is empty and is not evidence of default keep behavior. The Squeal fixture retains a nonempty assertion for its explicitly selected gate. When given an unselected gate, the revised assertion requires the original line. Default keep is proved by the changed flow test and the independent multi-gate bundle probes, not by claiming the real-CLI fixtures exercise that branch. The file's existing block, policy, unchanged HEAD, warm-up and result-reuse assertions remain intact. This is source inspection, not a claim that the forbidden real-CLI run passed.
- **Honesty and seams.** The “kept” message agrees with unchanged gate bytes. No result-status or delivery interface changes. `SetupAnswers` and `GivenAnswers` types, argument order, gate-before-block apply order, proposal contents, deadline and original-command fallback are unchanged.
- **Board and status.** The candidate records 005-60 done, 005-61 planned before release, and 005-62 after release; D5's amendment and status decision match this review's brief. No board/status repair is needed or made.

## Inputs for the next wave

No repair wave is needed for 005-60. The coordinator owns the landing/release decision and the board/status update after this report. Preserve the call sequence: plan ids and original/proposed lines, `answerPlan(plan, given, pick)`, then apply its per-id choices before block insertion. A supplied reword overrides keep for that id alone; an unanswered gate stays keep for `--yes`, Enter and EOF. The setup skill must keep passing an explicit flag for each answered gate. No public type or budget changes.

005-62 remains the already authorized later row for 005-59 N1 (single-quoted example), N2 (documentary `Use`), and S1 (missed execution-prefix gate). Their fixtures and worker-sized repairs remain in `reviews/wave-7.6.md`; this short review does not reopen them. Keep the 110,000 ms proposal budget, explicit-choice semantics, exact genuine rewordings and no model/real-harness probes.
