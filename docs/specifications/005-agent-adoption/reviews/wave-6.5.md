# Narrow re-review of wave 6.5 (005-45)

Initial findings written 2026-10-14 08:05 UTC, within 15 minutes of starting; extended and finalized at 08:12 UTC.

## Verification

Checkout: `6af0c836bbe522769d95ab807902b9eb7ecfa00c`, a documentation-only child of the content endpoint `309fc44a` plus `f5d64f5f` (0.1.159). `git diff f5d64f5f..HEAD --stat` contains only the board and review brief. This is the checkout context the task explicitly supplied, not a finding. The reviewed repairs are `d967555b`, `f83fc7fa`, `b2c28837`, and the warm-up test correction `f5d64f5f`.

The tree was clean for installation, lint, typecheck, the independent full-suite start, and both original reproduction probes. Only this review document is authored while the full suite runs; no product or test file changes. Broad verification is on the documentation child, not the exact content endpoint, and is **unverified as exact-endpoint evidence** under the reviewer rule. The later project/runner-union and synthetic-guard probes ran with this review file untracked, so their clean-tree evidence is also **unverified** under that rule; they supplement the source inspection and original clean-tree reproductions. Those qualifications are not wave findings.

```text
$ git rev-parse HEAD
6af0c836bbe522769d95ab807902b9eb7ecfa00c
$ git status --short
(empty before verification and probes)
$ npm ci
added 56 packages, and audited 57 packages in 1s
18 packages are looking for funding
found 0 vulnerabilities
(exit 0)
$ npm run lint
> squeal@0.1.159 lint
> biome check .
Checked 1001 files in 634ms. No fixes applied.
(exit 0)
$ npm run typecheck
> squeal@0.1.159 typecheck
> tsc --noEmit
(exit 0, no diagnostics)
$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  470 passed | 1 skipped (471)
     Tests  3965 passed | 9 skipped (3974)
  Start at  10:02:49
  Duration  543.50s (tests 98%, import 2%)
   Isolate  471 workers spawned · ~127ms startup each (spawn + environment, per file)
            at least ~14.81s faster with isolate: false — reuses workers across files instead of one per file
(exit 0; exactly one full run; start time is local, UTC+02:00)
```

npm warned about unknown environment config `store-dir`, and optional install scripts for `@parcel/watcher@2.6.0` and `esbuild@0.28.2` not covered by `allowScripts`. Installation exited 0. `npm run build` is explicitly forbidden, so bundle rebuild/drift is **unverified**. No model session, real Claude or Codex, real harness config directory, or command as `squeal-e2e` is used. The normal `.test.ts` suite includes the spawn-free guard tests; real-CLI cases end in `.real.ts` and are not selected.

The full run also printed two `repair: gitdir incorrect` notices for scratch scheduler worktrees, `squeal tests: killing 1 process(es) an earlier run left: 1933621`, and three experimental typecheck warnings. It exited 0 with no failing test. The complete independent-run output was read. The 005-46 re-run flake did not recur. No second full-suite run or targeted Vitest run was started. Throwaway reproduction fixtures and probe scripts were removed before committing.

## Verdict

**PASS `f5d64f5fa5f155504ea6011381bbd44c668d7075` (content endpoint `309fc44a` plus the test correction): 0 blockers, 0 should-fix, 0 nits, 0 new Next findings.** Both prior blockers are closed by source inspection and fresh reproductions. S1 is repaired. The independent full suite exited 0 at the documented checkout.

## Blockers

None.

## Previously reported findings

### B1 closed (proven): per-project exclusions survive the validation seam

`src/cli/setup/plan.ts:183` retains full projects for the private validation universe before constructing the public runner summary. `src/cli/setup/test-globs.ts:24` subtracts exclusions within each project, then unions the effective project sets and listed files. `init`, setup application and `--check` therefore use the same file set. The node:test adapter's contract is unchanged.

The prior review's exact scratch configuration and Vitest include (`src/**/*.test.ts`) were replayed through the actual node:test lister, `readPlan`, `main` init/setup and `--check`. No subject/test/artifact was executed. Output:

```text
B1 actual node:test files: []
B1 validation universe: []
B1 init slow+input exit: 1
squeal init: --slow packages/cezar/test/unit/a.test.ts selects no test file; nothing changed
B1 setup slow+input exit: 1
squeal setup: --slow packages/cezar/test/unit/a.test.ts selects no test file; nothing changed
B1 init input only exit: 1
squeal init: --input packages/cezar/test/unit/a.test.ts=packages/cezar/dist/**: packages/cezar/test/unit/a.test.ts selects no test file; nothing changed
B1 setup input only exit: 1
squeal setup: --input packages/cezar/test/unit/a.test.ts=packages/cezar/dist/**: packages/cezar/test/unit/a.test.ts selects no test file; nothing changed
B1 check exit: 1
  squeal.config.json: the slow.include entry "packages/cezar/test/unit/a.test.ts" selects no test file
  squeal.config.json: the inputs key "packages/cezar/test/unit/a.test.ts" selects no test file
```

Each refused write path leaves scratch `git status --porcelain` empty. The input-only checks also prove that the first slow-glob refusal does not mask a surviving input-glob bug. `test/cli/setup/init-flags.test.ts:306` covers both write paths, existing invalid declarations, and preservation of a file another node:test project or Vitest lists.

A separate source probe checked the project/runner union with scratch fixtures:

```text
B1 excluded file retained through another project: true
B1 excluded file retained through another vitest: true
(probe exit 0)
```

### B2 closed (proven): explicit file-relative evidence survives the suffix safeguard

`src/cli/setup/artifacts.ts:189` accepts an explicit `./` or `../` path when the test file's own directory resolves it under the candidate. The suffix safeguard still applies to bare strings. No ranking/default code changed.

The prior review's exact scratch fixture was replayed: `../../dist/cli/squeal.mjs` and a plugin path in `plugin-copy.test.ts`, `export {};` in `shipped-plugin.test.ts`, ignored root artifact present. `readPlan` and `answerPlan` took every default without running a test or artifact. A separate bare-string fixture retained the prior negative.

```text
B2 explicit import evidence: [{"path":"dist","rules":["bin","files","build-script","named"]},{"path":"plugins","rules":["files","named"]}]
B2 defaults: [{"test":"test/e2e/**","input":"dist/**"}]
B2 bare negative evidence: [{"path":"dist","rules":["bin","files","build-script"]},{"path":"plugins","rules":["files","named"]}]
B2 defaults: [{"test":"test/e2e/**","input":"plugins/**"}]
Both original reproductions and input-only refusal checks passed.
(probe exit 0)
```

`test/cli/setup/candidates.test.ts:180` adds the positive with a bare string in the other test file and pins named evidence, rank and default. The prior bare-string negative at line 172 stays intact, as do the full-tie tests.

### S1 repaired: command and arguments are checked before spawn

`test/real-cli/isolated.ts:123` scans `cmd` and every `args` entry against the same secret set used for scratch environment values. `runIsolated` still calls the guard before building or spawning the sudo command. The optional synthetic secret set preserves the production default. `test/real-cli/isolated-guard.test.ts:33` exercises clean preservation by name, environment values, whole and embedded argument values, provider URL, command values, and refusal messages that omit the secret. It calls only `guard`, spawning nothing.

A separate source probe called only `guard` with synthetic key/URL values and asserted both refusal and nondisclosure; it created no directory under the throwaway user's home:

```text
S1 command, whole/embedded argument and provider URL refused without disclosing synthetic value: true
S1 preserved credential name accepted: true
(probe exit 0)
```

### Warm-up test premise fits the implementation

`test/cli/warmup.test.ts:192` now requires at least one waiting line. It still requires unique full progress lines, a final progress line without the load-wait claim, and every file current. `src/cli/warmup.ts:267` deduplicates the full rendered line, which includes the done count: fast completions during a slow-file wait legitimately produce distinct waiting lines. The correction removes only the false exactly-once assertion; the observable contract remains checked.

## Should-fix

None.

## Nits

None.

## What fits

- B1 and B2's original failure scenarios now produce the required refusals and root-artifact default respectively.
- Per-project subtraction preserves files another project or runner lists; it does not apply one project's exclusion globally.
- Explicit file-relative evidence and the ambiguous bare-string negative are independently covered.
- The guard's new normal-suite tests use synthetic credentials and no subject process.
- The warm-up test still checks changed-line deduplication and removal of the waiting claim when the held file runs.
- Both committed CLI bundles contain the repaired `names` and `testFileUniverse` branches. This source comparison does not substitute for the forbidden rebuild/drift check.

## Next

No additional issue found within this bounded review. The recorded node:test re-run flake (board row 005-46) belongs to 001 and is not re-prosecuted here; it did not recur in this run. Build drift and real-CLI/model proof remain outside this task's authorization.

## Inputs for the next wave

No fix wave is required by the scoped reproduction evidence. Keep passing full node:test projects, including `exclude`, into `testFileUniverse`; expose the summary separately. `normalizeGlobs` and `unselected` must consume that same universe. Keep explicit relative-path qualification before the bare-string suffix veto. Call `guard` before constructing/spawning a subject command; credentials travel by preserved names or stdin. The coordinator owns release and any broader verification.
