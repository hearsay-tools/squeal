# Issue 133: passing runtime tests do not prove TypeScript validity

Research on 2026-11-01. Recommendation: consider an opt-in, project-configured
TypeScript check as separate evidence from runtime tests. The deciding tradeoff
is earlier compiler feedback against the cost and invalidation scope of a whole
TypeScript project. This report does not define a contract or amend a spec.

## Questions and verdict

| Question from the brief | Answer and provenance |
|---|---|
| 1. Can a test pass at runtime while its duplicate spread property fails typecheck? | **Verified by experiment**, Vitest 5.0.3 / TypeScript 7.0.2: one test passed; `tsc --noEmit` exited 1 with TS2783. |
| 2. Does shipped Squeal reproduce the missing compiler failure? | **Verified by experiment**, Squeal 0.1.390: the same file was current with no known failures, both initially and after an edit reintroduced the error. |
| 3. Does this contradict current runtime-result semantics? | **Read in source code**, Squeal 0.1.390 at `6e4094c132fae1e7d80ee56572f058265abc927e`: the primer explicitly excludes typecheck; the Vitest adapter filters out the TypeScript pool. C4/C5/C6/C14 and 013 describe runtime test evidence. |
| 4. Is an optional project-configured no-emit check feasible? | **Verified by experiment**, TypeScript 7.0.2: this explicit project config detects and clears the diagnostic without a build command. **Inferred**, same versions: a separate check could expose it; scheduling, dependency keys and per-file attribution remain unproved. |
| 5. Was the original Cezar incident reproduced exactly? | **Not determined, because** this bounded probe did not check out Cezar PR 2407 or run its workspace configs, CI or Claude Code delivery. It reproduces the same compiler/runtime/status gap in a minimal project. |

## 1. Compiler and runtime proof

**Verified by experiment, TypeScript 7.0.2 and Vitest 5.0.3.** The complete fixture
is [probes/issue-133](probes/issue-133/README.md). Its critical lines are:

```ts
const extra: { size: number } = { size: 2 };
const entry = { size: 1, ...extra };
```

The test asserts `entry.size === 2`. The later spread supplies that value at
runtime. The compiler still rejects the overwritten explicit property. Commands
ran from a fresh scratch Git repository with its own `vitest.config.ts`, including
only `duplicate.test.ts`, one worker, and no repository global setup:

```text
$ pnpm exec vitest run --config vitest.config.ts duplicate.test.ts
Test Files  1 passed (1)
     Tests  1 passed (1)
[exit 0; Vitest duration 153ms]
$ pnpm exec tsc --noEmit --pretty false -p tsconfig.json
duplicate.test.ts(4,17): error TS2783: 'size' is specified more than once, so this usage will be overwritten.
[exit 1]
```

The control removed only `size: 1,`. Runtime still passed; compiler exit became 0
(0.257 s wall time). Reintroducing the duplicate with a preceding comment moved
the diagnostic to `(5,17)` and compiler exit back to 1 (0.278 s). The comment gave
the file new bytes for Squeal. These timings are single observations, not a
workspace performance estimate. The no-emit config includes only this test and
sets strict mode, Bundler resolution, `skipLibCheck: true` and `types: []`.

## 2. Shipped Squeal proof

**Verified by experiment, installed Squeal 0.1.390.** The executable was
`/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal`, not a development build.
After `squeal start`, the explicit command was:

```text
$ /home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 60000 duplicate.test.ts
Revision: 0
Selected: duplicate.test.ts
Run asked: duplicate.test.ts was unknown with nothing queued, so this wait asked its one run at these inputs, as `/home/agent/.codex/plugins/data/squeal-hearsay/bin/squeal retry duplicate.test.ts` does.
Named test files at revision 0: no known failures; 1 test file, each with a current result, after 1.3 s. Worktree: known failures 0; all 1 test file current
```

Exit was 0. The control produced the same verdict at revision 1. Reintroducing the
type error produced it at revision 2, after 0.3 s, exit 0, while the compiler
failed. `squeal why 'the spread wins at runtime' --json` then recorded
`outcome: pass`, `validity: current`, `observedAt: 2`, `origin.kind: own`, and run
`6fed7027-5a51-4bcd-982d-2abc71bf3dcc`. This was a new runtime result, not a stale
or inherited pass. The scratch repo had no commit; provenance correctly said
`commit: null`, `dirty: true`. Full output is in
[reintroduced-output.txt](probes/issue-133/reintroduced-output.txt).

**Verified by experiment, this Linux host:** Node 24.22.1, pnpm 12.15.0;
`nproc` and `os.cpus().length` both gave 24. Initial `/proc/loadavg` was
`2.52 1.93 2.75`; before live start it was `2.94 2.11 2.77`; a later control-stage
sample was `6.75 3.28 3.10`. The one-minute load stayed below 24 at those samples,
so the live probe was not skipped. No full-suite checkpoint or build was run.
The probe daemon was stopped after recording the evidence.

## 3. Scope and feasibility

**Read in source code, Squeal 0.1.390 / commit above.**
`src/runners/vitest/adapter.ts:775` says “Typecheck specs (`tsc`, no module graph)
are not supported in v1”; `supported()` filters `s.pool !== "typescript"`.
`src/harness/shared/primer.ts:219` produces “Squeal does not cover typecheck,
build ...”. Merely enabling a Vitest typecheck project is therefore not evidence
that this adapter runs it. That configuration was not tested here.

**Read in official docs, repository specs at the same commit.** C4 ties current
validity to a check's key. C5 records transitions of known check results and a
file-level load result. C6 reports those stored states. C14 uses runner-provided
check identities, closures, environments and `RunReport`. 013 Scope/V1/V4 wrap
`vitest/node` and its test reporter outcomes. A file that loads and whose runtime
assertion passes supplies no compiler diagnostic to those outcomes. Both owning
status logs were checked for relevant decisions; this report changes none.

**Inferred, from the experiment and those contracts.** The missing signal is a
separate validation scope, not evidence of an incorrect runtime pass or stale
result. An optional explicit project config is plausible: the compiler already
provides a diagnostic code, path, line and column, and a process exit code. A
compiler invocation can be kept outside the test run, as the probe does.

A changed `.ts`/`.tsx` path can trigger a project check, but these results do not
prove that only that path determines its diagnostics. A safe key cannot simply
reuse a runtime test closure without evidence that it includes the compiler's
inputs. C4 validity, C5 diagnostic transitions, C6 coverage wording, and C14
check ownership need a later design decision if typecheck joins Squeal. Giving
an error the path it names also leaves project/config errors without such a
path unresolved. No per-file scheduler or protocol change is proposed here.

## Limits and open questions

**Verified by experiment, pnpm 12.15.0 / Squeal 0.1.390:** the first `pnpm exec`
auto-installed through the scratch dependency symlink and changed this worker
checkout's ignored install metadata. Background validation then reported three
failures: `test/scheduler/runtime-files-rollback.test.ts:49` and
`test/scheduler/busy-merge.test.ts:53,97`. Their cause is **not determined**.
The worker daemon was stopped to end the unintended broad background run; its
last notice still counted 1,979 pending checks. Offline frozen-lockfile repair
with scripts disabled exited 0; no build ran. These repository checks remain
unresolved and are not the probe verdict. Both daemons are stopped. See the
probe README for the exact repair command and safer repeat setup.

- **Not determined:** behavior and cost of the actual Cezar `tsconfig.test.json`
  and web check, project references, ambient types, config inheritance, or a
  change whose diagnostic is in another file. Those need workspace probes.
- **Not determined:** incremental/watch reuse, cancellation, compiler versions
  other than 7.0.2, and emission from configurations unlike this fixture. A
  `--noEmit` success here does not establish a side-effect policy for arbitrary
  repository commands or build configurations.
- **Not determined:** compiler-failure/recovery delivery through Claude Code or
  Codex. The live proof covers Squeal daemon execution, stored provenance and CLI
  verdicts; there is no implemented typecheck signal to exercise.
- **Reported by the issue, not independently verified:** Squeal 0.1.389, original
  revision 47, CI TS2783 and the reported 25-minute cost. This probe used 0.1.390.

## Sources

1. [Issue 133](https://github.com/hearsay-tools/squeal/issues/133), fetched with
   `gh issue view 133 --repo hearsay-tools/squeal --json title,body,comments,url`
   on 2026-11-01. Named original evidence: Cezar run 41302127858 / PR 2407.
2. [011 C4, C5, C6, C14](../spec.md), [011 status](../status.md),
   [013 Scope/V1/V4](../../013-vitest-runner/spec.md),
   [013 status](../../013-vitest-runner/status.md), read at
   `6e4094c132fae1e7d80ee56572f058265abc927e`.
3. [Vitest adapter source](https://github.com/hearsay-tools/squeal/blob/6e4094c132fae1e7d80ee56572f058265abc927e/src/runners/vitest/adapter.ts#L775),
   [primer source](https://github.com/hearsay-tools/squeal/blob/6e4094c132fae1e7d80ee56572f058265abc927e/src/harness/shared/primer.ts#L219),
   and local `src/core/types/runner.ts` (`RunnerAdapter`, `RunReport`).
4. [Probe commands and environment caveats](probes/issue-133/README.md),
   [initial output](probes/issue-133/initial-output.txt),
   [control output](probes/issue-133/control-output.txt),
   [edited-file output and provenance](probes/issue-133/reintroduced-output.txt).
