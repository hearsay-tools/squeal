# Wave 7.5: narrow re-review of 005-55 (005-56)

## Verification output

Started 2026-10-14 about 10:44 UTC. Initial findings written 2026-10-14 10:52 UTC, within 15 minutes. Extended 2026-10-14 11:02 UTC with the completed independent suite output.

Named candidate: `f6f75749f2af549afd662c32f820c7456c459eea`. Actual checkout: `461ae5e01f641e4051715271ae72d9444694745b`, initially clean, package version 0.1.162. The later commits rebuild the plugins and add the brief/board. `git diff --exit-code f6f75749 HEAD -- src/cli/setup test/cli/setup plugins/claude-code/skills/setup plugins/codex/skills/setup test/harness/setup-skill.test.ts` exits 0. Review source is identical. HEAD mismatch is recorded under Next; the reviewer changes no candidate code.

All checks started on clean `461ae5e0`, rather than the exact named endpoint. The reviewer skill therefore labels their exact-candidate verification **unverified**. Only this findings file is added while Vitest runs, so the full-suite evidence additionally has a documentation-only dirty-tree qualification. Neither qualification blocks the wave. Build is deliberately omitted under the explicit 005-56 brief.

```text
$ git rev-parse HEAD
461ae5e01f641e4051715271ae72d9444694745b
$ git status --short
[no output before checks]
$ npm ci
added 56 packages, and audited 57 packages in 5s
18 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
[exit 0]
$ npm run lint
> squeal@0.1.162 lint
> biome check .
Checked 1028 files in 5s. No fixes applied.
[exit 0]
$ npm run typecheck
> squeal@0.1.162 typecheck
> tsc --noEmit
[exit 0]
$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  479 passed | 1 skipped (480)
     Tests  4064 passed | 10 skipped (4074)
  Start at  12:47:52
  Duration  843.50s (tests 97%, import 2%, transform 1%)
   Isolate  480 workers spawned · ~179ms startup each (spawn + environment, per file)
            at least ~21.32s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

Exactly one independent full suite completed. It printed two scratch `repair: gitdir incorrect` diagnostics, `squeal tests: killing 1 process(es) an earlier run left: 3256249`, and three experimental type-testing notices. None failed the run. Sampled host one-minute load ranged from 91.32 to 16.72; no failed file needed an isolated rerun. All throwaway probes were removed before committing the findings.

Probes bundle only `gates.ts` to a temporary ESM module, without rebuilding committed bundles. Seven original/required fixtures pass exact scanner and disk-write/refusal assertions. The three failure probes below are each committed as `AGENTS.md` in a scratch Git repository, scanned using `git ls-files`, selected through `rewordGates`, and read back from disk; their actual output equals the proposal. These are concrete writes, not regular-expression guesses. Corpus sources are never edited. No model session, real Claude/Codex, or `squeal-e2e` invocation occurs. Cezar is read only using the specified `git show`.

## Verdict

**FAIL: 2 proven blockers, 1 proven should-fix, 0 plausible findings, 0 nits.** The exact prior B1, B2 and B3 fixtures close. Their nearest realistic variants still demonstrate wrong instructions. Both blockers violate goal 5 and 005-56's rule: "A blocker is a line that is still reworded into a wrong or broken instruction."

## Blockers

### R1. Proven: a sentence inside a quoted example is treated as an instruction

Locations: `src/cli/setup/gates.ts:227` (sentence stops), `:258` (command-sentence start), `:263` (allow-list acceptance), `:322` to `:323` (fallback placement).

Contract: 005-55 says the line must "plainly tell[] the agent to run the test command"; 005-56 requires the fallback "right after its own sentence" and no wrong or broken instruction.

Committed instruction-file fixture:

```markdown
Keep "Do not commit generated files. Run `npm test` before you finish." unchanged.
```

Actual proposal and disk write:

```markdown
Keep "Do not commit generated files. Run `squeal run --all --wait 110000` before you finish." If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. unchanged.
```

The requested action is to keep quoted text unchanged. Setup instead modifies the quotation, adds an instruction to run a test, and leaves `unchanged.` as a broken fragment. Sentence detection tracks parentheses/brackets but not quotation context, so the period inside the quote resets the allow-list to `Run`. This is the same class seen in the rerun corpus: the old review's prose at `reviews/wave-7.md:101` ends in `Keep "Do not commit generated files. Run ..." rewordable.` and is reworded into a dangling `rewordable.`. That file is corpus input only, not reviewed work or the target of this finding.

Worker-sized fix: leave command sentences inside quoted examples as mentions, or conservatively refuse an ambiguous quotation before resetting the sentence context. Do not insert a fallback between a quotation and its containing sentence's remainder. Add the exact committed-fixture regression to scanner and write/refusal tests; preserve the unquoted two-sentence imperative required by D5.

### R2. Proven: an allowed verb does not establish that the test command is being run

Locations: `src/cli/setup/gates.ts:39` (`INSTRUCTION`), `:262` to `:263` (only the prefix before the command is checked).

Contract: 005-55's outcome is "only for a line that plainly tells the agent to run the test command. Every other line holding the command becomes a mention"; 005-56 blocks a wrong instruction.

Committed fixture:

```markdown
Use `npm test` as an example in the README.
```

Actual proposal and disk write:

```markdown
Use `squeal run --all --wait 110000` as an example in the README. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

This instructs the agent to write documentation, not to execute tests. The replacement changes the documented command and invents a fallback to run it. The same public write-path proof passes for `Run the documentation generator to document npm test` with the test command in a code span: the imperative executes the generator, while the test command is its subject matter. An allow-listed first verb alone cannot distinguish either from a test gate. These are descriptive-command variants of prior B1, reopened by the new `Use`/`Run` acceptance path.

Worker-sized fix: conservatively require that the recognized imperative applies to executing the matched command. Treat `as an example`, `to document` and similarly ambiguous uses as mentions. Pin both examples through scan and refusal/write tests, preserving genuine `Use npm test to check your change` and `Run npm test before you finish` gates. Keep this change within `gates.ts` and its tests; no new plan or skill interface is needed.

## Should-fix

### S1. Proven, nonblocking: common direct gate phrasing becomes a mention

Location: `src/cli/setup/gates.ts:39`.

The probe separately scans these realistic instruction-file lines:

```markdown
Please run `npm test` before committing.
After changing code, run `npm test`.
Make sure to run `npm test` before you finish.
You must run `npm test` before committing.
```

Each is listed as a mention, with no gate proposal. `Make sure to run` is also pinned as a mention in `test/cli/setup/gates-allow-list.test.ts:125`. This is a deliberate conservative boundary, not a broken write; the brief explicitly classifies missed gates as should-fix. A later worker may add narrowly defined execution phrasing with exact output regressions, after preserving mention refusal. Do not broaden the verbs until R1/R2 are resolved.

## Nits

None.

## What fits

- Prior B1: `The npm test command runs the unit suite` (with its code span) is a mention; selecting it is refused and leaves the file unchanged.
- Prior B2: both `Do not run the whole suite,` followed by `including npm test.` and `Do not run tests manually (e.g. via npm test).` are mentions and cannot be selected for a write.
- Prior B3: `Run npm test before finishing (e.g. after code review).` rewords exactly with the fallback outside the parentheses after the real sentence end.
- D5's first `VITEST_GATE` example, `Run npm test before you finish.`, and `Do not commit generated files. Run npm test before you finish.` each match the complete expected output. The historical example preserves lint, typecheck, build, and its final request to paste output.
- Abbreviations `e.g.` and `i.e.` outside parentheses, and a dotted reference inside parentheses, preserve the command's full sentence in the additional probes.
- The prior appendix's 80 isolated input lines yield 4 proposals (old corpus entries 5, 60, 70, 71) and 76 mentions. The whole-file rerun preserves wrapping and fences and is listed below.
- Cezar's complete file has no proposals and ten mentions. The five original lines 172, 185, 201, 237 and 326 remain unreworded. The real Squeal tracked-path scan has no gates and two role-skill mentions; its own already-reworded Verification line is not offered again.
- An independent subprocess invoking the committed 0.1.162 bundle with `setup --yes --harness none --block none --no-trust --no-warmup --gate AGENTS.md:1=reword` on the B1 mention exits 1 and prints `squeal init: no gate line AGENTS.md:1; squeal setup --plan lists them; nothing changed`. The instruction file and directory entries are unchanged. The subprocess environment has only a system PATH; neither harness is available or launched.
- The new tests exercise scanner/write/refusal boundaries and exact output, not merely the helper regex. Their ten corpus samples cover eight mentions and two genuine instructions. The uncovered cases are quoted execution examples and imperative sentences whose test command is subject matter rather than the executed object.

## Inputs for the next wave

The status log says a second failing review ends this repair loop. The coordinator and human decide disposition; the reviewer does not dispatch, repair, land, or accept the review.

If a repair is authorized, one worker can own `src/cli/setup/gates.ts` and its gate tests for R1/R2. Preserve `scanGates(root, tracked, { nodeTest })` followed by selection/refusal in `rewordGates(root, tracked, ids, { nodeTest })`. Classify only after preserving containing prose/quote context, establish that the imperative executes the command, then check sentence completeness/compound commands before constructing the proposal. Keep the 110,000 ms wait, per-id choices, all-or-nothing refusal, original fallback command, symlink deduplication, and original B1–B3 closures. Regression inputs above are sufficient to dispatch this slice. A future narrow reviewer can rerun them plus the required three exact gates and the corpus without revisiting settled plan/skill surfaces.

## Next

- **Proven provenance note:** HEAD is `461ae5e0`, not the brief's `f6f75749`, as recorded above. Name the rebuilt integrated candidate explicitly in a future brief. This repeats the known prior S1 pattern and is nonblocking. Board/status are left unchanged.
- Build and unrelated architecture, installer, warm-up, D8, real-CLI sessions, and the spec folder's review/lessons content are outside this narrow review. Corpus inclusion is evidence about the scanner, not an audit of those files.
- The background Squeal baseline reported an unchanged `test/evals/arms.test.ts:24` 5-second timeout at load 77.57, then a PASS under the same inputs. This is not independent verification or a finding against 005-55. The independent suite subsequently passed, including this file.

## Corpus method and every remaining proposal

Snapshot before this findings file was created: **439 files**, tracked Markdown under `docs/`, both role-skill trees (`.claude/skills`, `.agents/skills`), both plugin skill trees, and `5dbb4b09:AGENTS.md` from Cezar. Each complete file is copied to a temporary `AGENTS.md`, then scanned with `nodeTest: true`, preserving original wrapping and fences. This yields **6 proposals, 1 refused gate, 655 mentions**. It measures hypothetical instruction-file handling; setup does not edit arbitrary docs or plugin skills. Five proposals are actual execution instructions with the fallback immediately after the matched sentence; corpus 3 is R1's false proposal. The one refused gate, `research/e2e-setup.md:107`, holds `SQ_REAL_CLI_CANDIDATE=<sha>` before the command and is not written. Existing review/lessons files are corpus text only.

The four proposals from the old appendix all persist in the full-file scan; the additional proposals are the new 005-56 rule and the quoted prose introduced in the prior review. Every remaining proposal and its complete result follows.

### Corpus 1: docs/specifications/001-core-loop/research/probes/pull-advances-push/README.md:16

Input:

```markdown
- `race/race.probe.ts`: the store races, against this checkout's real store, state sink and delivery. Run from the repository root after `npm ci`: `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts`.
```

Proposed:

```markdown
- `race/race.probe.ts`: the store races, against this checkout's real store, state sink and delivery. Run from the repository root after `npm ci`: `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts` instead.
```

### Corpus 2: docs/specifications/005-agent-adoption/research/probes/instruction-surfaces/conditions/c.md:3

Input:

```markdown
Before you finish, run `npx vitest run` and paste its output in your final message.
```

Proposed:

```markdown
Before you finish, run `squeal run --all --wait 110000` and paste its output in your final message. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 3: docs/specifications/005-agent-adoption/reviews/wave-7.md:101

Input:

```markdown
Worker-sized fix: retain the command sentence's preceding physical-line context, or refuse continuation lines conservatively; do not treat abbreviation stops as sentence boundaries that discard negation. Add both fixtures to the public scanner/write-path tests. Keep "Do not commit generated files. Run `npm test` before you finish." rewordable.
```

Proposed:

```markdown
Worker-sized fix: retain the command sentence's preceding physical-line context, or refuse continuation lines conservatively; do not treat abbreviation stops as sentence boundaries that discard negation. Add both fixtures to the public scanner/write-path tests. Keep "Do not commit generated files. Run `squeal run --all --wait 110000` before you finish." If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. rewordable.
```

### Corpus 4: docs/specifications/005-agent-adoption/tasks/wave-7.md:62

Input:

```markdown
- Run one full `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run one full `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 5: docs/specifications/005-agent-adoption/tasks/wave-7.md:84

Input:

```markdown
- Run exactly one `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run exactly one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 6: docs/specifications/005-agent-adoption/tasks/wave-7.md:143

Input:

```markdown
- Run exactly one `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run exactly one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```
