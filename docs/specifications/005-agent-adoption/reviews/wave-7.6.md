# Wave 7.6: narrow re-review of 005-58 (005-59)

## Verification output

Started 2026-10-14 about 11:39 UTC. Initial findings written 2026-10-14 11:46 UTC, within 15 minutes; independent suite still running at this first write. Extended 2026-10-14 11:57 UTC with the completed independent suite output.

Fix: `ce85050c2bdaaec0c20f371990b0f313abda5a18`, cherry-picked from `c46b6bbe`. Reviewed bundle: `f95ed1bb0541a8617e4953d4367ae11c5e6d5d99`, version 0.1.165. Initial checkout was clean `abd5682771555d7f96003918e678df8811361bb4`, exactly the documentation overlay the brief names. It differs from the bundle only in `docs/board.md` and spec 005's `status.md`. The reviewer temporarily detached at `f95ed1bb` before installing dependencies or running checks; the branch was restored at `abd56827` after the suite, before committing the findings. No unexpected HEAD mismatch.

```text
$ git rev-parse HEAD
f95ed1bb0541a8617e4953d4367ae11c5e6d5d99
$ git status --short
[no output before checks]
$ git diff --exit-code ce85050c f95ed1bb -- src/cli/setup/gates.ts test/cli/setup
[no output; exit 0]
$ git diff --exit-code f95ed1bb abd56827 -- src test plugins package.json package-lock.json
[no output; exit 0]
$ npm ci
added 58 packages, and audited 59 packages in 4s
19 packages are looking for funding
found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
[exit 0]
$ npm run lint
> squeal@0.1.165 lint
> biome check .
Checked 1065 files in 2s. No fixes applied.
[exit 0]
$ npm run typecheck
> squeal@0.1.165 typecheck
> tsc --noEmit
[exit 0]
$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  495 passed | 1 skipped (496)
      Tests  4179 passed | 10 skipped (4189)
   Start at  13:41:57
   Duration  873.14s (tests 97%, import 2%, transform 1%)

    Isolate  496 workers spawned · ~219ms startup each (spawn + environment, per file)
             at least ~26.99s faster with isolate: false — reuses workers across files instead of one per file
[exit 0]
```

Exactly one independent full Vitest invocation completed with exit 0. It is not replaced by Squeal's result. `npm run build` is deliberately omitted under the explicit 005-59 brief. Lint/typecheck finished on the clean exact candidate. This report was the only worktree addition during the suite; its output has a documentation-only dirty-tree qualification and is **unverified** as a strictly clean-tree completion under the reviewer skill, never a finding against the wave.

The suite also printed two scratch `repair: gitdir incorrect` diagnostics, an earlier-run process cleanup, and three experimental type-checking notices. None failed the run. Sampled host one-minute load was 38 to 89. During and after the suite, `git status --short` showed only this new findings file. All throwaway probe scripts and scratch directories were removed before the findings commit.

Independent probes use `node --import tsx` against the candidate's public `scanGates` and `rewordGates`, in disposable directories. Eleven named fixtures passed exact scan and write/refusal assertions: R1, both R2 examples, seven earlier fixtures, and the added genuine `Use` gate. Both committed plugin bundles were invoked separately on R1 and both R2 fixtures in a committed scratch repository, with `setup --yes --harness none --block none --no-trust --no-warmup --gate AGENTS.md:1=reword`, system-only PATH, and no inherited harness environment. All six invocations exited 1, printed the plan hint below, and left the instruction text and directory entries unchanged:

```text
squeal init: no gate line AGENTS.md:1; squeal setup --plan lists them; nothing changed
```

No model session, real `claude` or `codex`, or `squeal-e2e` invocation occurs. Cezar is read only through `git -C /home/agent/projects/cezar show 5dbb4b09:AGENTS.md`. Corpus sources are never written. Product code, bundles, board and status are unchanged.

## Verdict

**PASS for the bounded re-review: 0 blockers, 1 proven should-fix, 2 proven additional notes, 0 plausible findings, 0 nits.** The independent full suite exited 0; its documentation-only dirty-tree qualification is recorded above.

R1 and R2's three specified fixtures close. All seven earlier fixtures hold, as does the required genuine `Use` instruction. Every remaining corpus proposal is a genuine instruction with its fallback immediately after its own sentence. The two additional wrong-edit forms below are notes under the reviewer's re-review rule: "verify each previously blocking finding against the new candidate, inspect the delta, and file anything else as a note." They are not a claim that arbitrary instruction prose is now safe. This is the last authorized gate round; disposition belongs to the coordinator and human.

## Blockers

None in the bounded R1/R2, earlier-fixture and corpus re-review.

## Should-fix

### S1. Proven, nonblocking: stricter object prefixes miss a genuine corpus gate

Location: `src/cli/setup/gates.ts:41`, `:280`.

Prior corpus 1 (`docs/specifications/001-core-loop/research/probes/pull-advances-push/README.md:16`) used to be proposed and is now a mention. Its execution sentence is:

```markdown
Run from the repository root after `npm ci`: `npx vitest run --root docs/specifications/001-core-loop/research/probes/pull-advances-push/race --config vitest.config.ts`.
```

The isolated shorter probe `Run from the repository root after npm ci: npx vitest run` with both code spans also becomes a mention. `OBJECT_PREFIX` rejects `from the repository root after`, so a true instruction is missed. The brief explicitly says "A missed gate is a should-fix." The file is left intact and its command remains visible as a mention.

Prior S1's four common phrases remain mentions too: `Please run`, `After changing code, run`, `Make sure to run`, and `You must run`, each followed by the code-spanned `npm test`. This is the previously recorded conservative boundary, not a new blocker.

Worker-sized option if separately authorized: support a small set of execution-location/setup prefixes in `gates.ts`, pin the complete corpus line's output plus refusal counterexamples in `gates-allow-list.test.ts`, and preserve the explicit documentation and quotation exclusions. No plan or skill change is needed.

## Nits

None.

## What fits

- R1's exact straight-double-quoted example becomes one mention. The candidate also pins curly double quotes and a directly quoted command. Quoted stops no longer reset the containing sentence to `Run`.
- R2's `Use npm test as an example in the README` and `Run the documentation generator to document npm test`, with code spans, become mentions. Tests additionally pin `to describe` and `to explain`. Explicit selection is refused, including through each shipped bundle's CLI with a `squeal setup --plan` hint.
- Earlier B1 (`The npm test command runs the unit suite`, with a code span) and both B2 cases (wrapped negation and `e.g.` within negation) remain mentions; selecting their command lines is refused with unchanged bytes.
- Earlier B3 (`Run npm test before finishing (e.g. after code review)`, with its code span) gets exactly one fallback after the closing parenthesis and real sentence end. Selecting it writes exactly the proposal.
- D5's first `VITEST_GATE`, the plain gate, the unrelated-negation-then-gate, and `Use npm test to check your change` preserve exact complete expected output. Lint/typecheck/build in D5's example and its final request to paste output remain intact.
- A real gate followed by `Keep "Do not change this." unchanged.` keeps that quotation intact and places the fallback after the gate's sentence.
- The public function signatures and call order do not change. The only product change is local classification/sentence context in `gates.ts`; test additions cover public scanner and refusal behavior. The prior compound-command refusal remains unchanged.
- Both setup skill copies are outside the fix delta. No settled plan/skill interfaces or unrelated architecture were re-reviewed.

## Additional notes (Next)

These are proven write-path observations outside the named prior fixtures and corpus. They remain nonblocking under the bounded re-review rule, not findings against pre-existing modules outside the fix's boundary.

### N1. Proven note: single-quoted prose still produces R1's broken fragment

Location: `src/cli/setup/gates.ts:45`, `:225`, `:265` (only straight/curly double quotations are masked).

The 005-58 brief explicitly names `"…"` and `“…”`. A single-quoted variant is outside that specified quote set but still breaks the broader D5 intention to edit only execution instructions. A public scan followed by `rewordGates` writes:

Input:

```markdown
Keep 'Do not commit generated files. Run `npm test` before you finish.' unchanged.
```

Actual proposal and disk write:

```markdown
Keep 'Do not commit generated files. Run `squeal run --all --wait 110000` before you finish.' If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead. unchanged.
```

The final `unchanged.` is detached from its containing quotation. This is the same existing sentence-reset mechanism, with a quotation form the fix does not support. If the human authorizes more work, one worker can conservatively recognize balanced single quotation marks while retaining apostrophes in contractions, pin this exact scanner/refusal fixture, and keep the unquoted two-sentence gate exact. Do not merely add all apostrophes to a quote regex.

### N2. Proven note: other documentary uses still produce R2's wrong instruction

Location: `src/cli/setup/gates.ts:43`, `:277`, `:280`.

The exact `as an example` fixture closes; the exclusion matches only `as a/an example`. A public scan followed by `rewordGates` writes:

Input:

```markdown
Use `npm test` in the README.
```

Actual proposal and disk write:

```markdown
Use `squeal run --all --wait 110000` in the README. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npm test` instead.
```

`Use npm test as the documented example` with its code span is also reworded. These are instructions about documentation, not executing the command. Prefix object validation alone cannot classify the purpose after the command. If separately authorized, one worker can require an execution purpose for ambiguous `Use` sentences or leave unsupported suffixes as mentions; add these two refusal fixtures and preserve `Use npm test to check your change` exactly.

## Inputs for the next wave

No fix wave is dispatched by this review. The human receives the remaining limits because 005-59 is the last round. If any note is accepted for later work, the worker-sized slices and counterexamples are above.

Keep `scanGates(root, tracked, { nodeTest })` before `rewordGates(root, tracked, ids, { nodeTest })`. Establish containing quotation/sentence context, then whether the imperative executes the command, then existing sentence/compound refusals, then construct the proposal. Preserve 110,000 ms, each id's choice, original fallback command, symlink deduplication, and all-or-nothing selection refusal. Nothing here changes D8 or authorizes real-CLI proof sessions, a release, or building bundles in this worktree.

## Corpus method and every remaining proposal

Before this findings file was created, rerun the prior method on **443 tracked Markdown files**, including Cezar's fixed file: `docs/`, both role-skill trees (`.claude/skills`, `.agents/skills`), and both plugin skill trees. Complete files are copied individually to a disposable `AGENTS.md` and scanned with `nodeTest: true`, preserving wrapping and fences. Result: **4 proposals, 1 refused gate, 681 mentions**. It measures hypothetical instruction-file handling; setup does not edit arbitrary docs or plugin skills. Review/lessons content is corpus evidence only, not itself reviewed work.

Relative to wave-7.5's six proposals, its quoted false proposal is now a mention, and its `Run from the repository root after npm ci` proposal is now a mention (S1). The remaining four proposals below are genuine execution instructions. The existing refused gate remains `research/e2e-setup.md:107`, whose code span prefixes the test with `SQ_REAL_CLI_CANDIDATE=<sha>`; it is not written.

### Corpus 1: docs/specifications/005-agent-adoption/research/probes/instruction-surfaces/conditions/c.md:3

Input:

```markdown
Before you finish, run `npx vitest run` and paste its output in your final message.
```

Proposed:

```markdown
Before you finish, run `squeal run --all --wait 110000` and paste its output in your final message. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run` instead.
```

### Corpus 2: docs/specifications/005-agent-adoption/tasks/wave-7.md:62

Input:

```markdown
- Run one full `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run one full `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 3: docs/specifications/005-agent-adoption/tasks/wave-7.md:84

Input:

```markdown
- Run exactly one `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run exactly one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```

### Corpus 4: docs/specifications/005-agent-adoption/tasks/wave-7.md:143

Input:

```markdown
- Run exactly one `npx vitest run --maxWorkers=4`.
```

Proposed:

```markdown
- Run exactly one `squeal run --all --wait 110000`. If it exits 3 at its deadline, run it again; if it exits 3 for another reason, `squeal` is unavailable, or you doubt its result, run `npx vitest run --maxWorkers=4` instead.
```
