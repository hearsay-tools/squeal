# Wave 13bm: narrow re-review 001-371 of repair 001-370

Candidate: `e751a5368804505571508b0aa08ce78ad16dbafb` (0.1.168), pinned detached. Scope: the 001-370 repair commits `a1036d3a`, `635c74b2`, `6dc976ef`, `17b29488`, `463b1d06`, and coordinator build/amendment `e751a536`. The board and prior review commits returned by the grep are context, not product changes under review. This is the second round against `wave-13bl.md` B1, S1, S2, N1 and the coordinator's configured-filter widening reproduction.

## Verdict

PASS: zero blockers, zero should-fix items, one proven metadata nit. Wave-13bl B1, S1, S2 and N1 are addressed. The configured-filter widening repair preserves Vitest’s own selection semantics. No new correctness break was found in the repair delta.

## Verification

The clean candidate passed dependency installation, lint, typecheck and build. Build produced no tracked drift, including either plugin's bundles. The sole independent full suite, `npx vitest run --maxWorkers=4`, exited 0: 498 files passed, one skipped; 4,170 tests passed, 49 skipped. No tracked source, test, config or bundle changed during that run. Report-only partial commit `a0393348` temporarily moved HEAD, then HEAD returned to the clean candidate before the suite ended. Afterward, the two-file baseline red proof reproduced five failures; restoring the candidate gave 51 passing tests across the five focused files. No full suite was repeated. `npm ci` deleted no tracked fixture symlink; no fixture restoration was needed.

All validation commands and probes use a task-private temporary HOME, CODEX_SESSION_ID unset, GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1. No third-party agent tooling or eval runner is invoked. Probes create and remove private copies below this worktree's ignored `test/fixtures/vitest/.tmp/`. No live external daemon, store or worktree is inspected or controlled. Vitest is the independent review gate required by the brief and reviewer skill, rather than a Squeal checkpoint.

Command prefix:

```sh
env -u CODEX_SESSION_ID HOME=<task-private-temporary-home> GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
```

```text
$ npm ci
added 58 packages, and audited 59 packages in 9s

19 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
npm notice
npm notice New major version of npm available! 11.19.0 -> 12.2.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.2.0
npm notice To update run: npm install -g npm@12.2.0
npm notice
exit 0
```

```text
$ npm run lint
> squeal@0.1.168 lint
> biome check .

Checked 1068 files in 982ms. No fixes applied.
exit 0
```

```text
$ npm run typecheck
> squeal@0.1.168 typecheck
> tsc --noEmit
exit 0
```

```text
$ npm run build
> squeal@0.1.168 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.168 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
```

```text
$ npx vitest run --maxWorkers=4
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/4a638c9a-b803-4e72-9f7f-cc80b210c278

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/4a638c9a-b803-4e72-9f7f-cc80b210c278/test/fixtures/scheduler/.tmp/86c345ef-4c17-4313-9d8f-4400c4f219b3/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/4a638c9a-b803-4e72-9f7f-cc80b210c278/test/fixtures/scheduler/.tmp/59ea0156-5f8c-49fc-af31-c2b1abef8580/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 379321
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  498 passed | 1 skipped (499)
      Tests  4170 passed | 49 skipped (4219)
   Start at  14:48:19
   Duration  793.34s (tests 97%, import 2%, transform 1%)

    Isolate  499 workers spawned · ~211ms startup each (spawn + environment, per file)
             at least ~26.17s faster with isolate: false — reuses workers across files instead of one per file


exit 0
```

```text
$ git rev-parse HEAD
e751a5368804505571508b0aa08ce78ad16dbafb
$ git status --short
(no output before and after the full suite)
$ git diff --exit-code -- src test plugins/claude-code/dist plugins/codex/dist
(no output; exit 0)
```

### Local red/restore proof

Only after the independent suite ended, the exact 001-349 source versions were restored temporarily from `58eff841f71af0699108f6bf574feea2ff00cef2`. The new tests, bundles and all other candidate files stayed unchanged. This dirty baseline is deliberately separate from the clean-candidate verification.

```text
$ git restore --source=58eff841f71af0699108f6bf574feea2ff00cef2 --worktree -- src/runners/vitest/exclude.ts src/runners/vitest/adapter.ts
$ git diff --stat -- src/runners/vitest/exclude.ts src/runners/vitest/adapter.ts
 src/runners/vitest/adapter.ts |  5 +--
 src/runners/vitest/exclude.ts | 83 ++++++++++---------------------------------
 2 files changed, 22 insertions(+), 66 deletions(-)
$ npx vitest run --maxWorkers=4 test/runners/vitest/exclude-projects-filter.test.ts
 Test Files  1 failed (1)
      Tests  5 failed | 4 passed (9)
   Duration  1.56s
exit 1
```

The four run-selection regressions fail because the baseline lists `a c` instead of `a` in the first three cases, and `b c` instead of `b` in the fourth. The checker regression produces two false extra notes:

```text
+ squeal.config.json: "vitest.excludeProjects[0]" names no Vitest project ("c"); it is left out
+ squeal.config.json: "vitest.excludeProjects[1]" names no Vitest project ("C*"); it is left out
  squeal.config.json: "vitest.excludeProjects[2]" names no Vitest project ("nope"); it is left out
```

The two no-exclusion baselines and two environment digest tests remain green, distinguishing the filter repair from S1's corrected wording. Restoring the candidate makes every new filter test pass, and also rechecks the original exclusion, status, both harness primers and the key-format pin:

```text
$ git restore --source=e751a5368804505571508b0aa08ce78ad16dbafb --worktree -- src/runners/vitest/exclude.ts src/runners/vitest/adapter.ts
$ git diff --exit-code -- src test plugins/claude-code/dist plugins/codex/dist
(no output; exit 0)
$ npx vitest run --maxWorkers=4 test/runners/vitest/exclude-projects-filter.test.ts test/runners/vitest/exclude-projects.test.ts test/status/excluded-projects.test.ts test/harness/primer-excluded.test.ts test/keys/key-format.test.ts
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/4a638c9a-b803-4e72-9f7f-cc80b210c278


 Test Files  5 passed (5)
      Tests  51 passed (51)
   Start at  15:02:57
   Duration  2.54s (tests 63%, transform 28%, import 9%)

  Transform  transforming modules took 2.06s · 28% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns


exit 0
```

## Blockers

None.

## Should-fix

None.

## Nits

### N1. The coordinator build leaves the lockfile's root version behind (proven)

`package-lock.json:3` and `package-lock.json:9` still say `0.1.167`. The four shipped version files say `0.1.168`: root `package.json`, `plugins/claude-code/package.json`, and both plugin manifests. Before `e751a536`, both root package and lockfile said `0.1.167`; its version bump introduces the mismatch. `npm ci` succeeds and leaves the lockfile unchanged, so this is metadata drift, not a runtime or validation failure. Update both root version fields in the lockfile in the next version/build commit. No dependency change is needed.

## What fits

### B1 and the configured-filter widening repair (proven by source and real adapter probes)

Vitest 5.0.3's `TestConfigPlugin` at `node_modules/vitest/dist/chunks/index.DpLw24bj.js:9533` merges CLI options over `config.test` with arrays replaced. `resolveTestConfig` at `:14385` normalizes `project` to an array. `applyProjectFilter` at `:13117` retains every entry for an empty filter; `matchesEntryFilter` at `:13160` first rejects any matching negative entry, then ORs the positive entries over each name and its ancestors. Appending exclusions as negative entries therefore preserves configured positives and negatives and only subtracts selected entries.

`src/runners/vitest/exclude.ts:33` reads that configured filter; `:34` appends `!name`; `:58` explicitly clears the configured filter for the complete unknown-name universe. The wildcard matcher is unchanged. With a positive configured filter `["A*"]` and exclusions `["b", "C*", "nope"]`, the adapter lists only `a` and reports only index 2 (`nope`), even though configured selection omitted `b` and `c`. The same result holds for configured `["!C*"]` and exclusions `["c", "C*", "nope"]`: `a b`, only `nope` unknown.

| Configured filter | Exclusions | Baseline projects | Retained projects |
| --- | --- | --- | --- |
| `["a"]` | `["b"]` | `a` | `a` |
| `["!c"]` | `["b"]` | `a b` | `a` |
| `["a","b"]` | `["b"]` | `a b` | `a` |
| `["!c"]` | `["a"]` | `a b` | `b` |
| `["a*","b*","!c*"]` | `["B*"]` | `a b` | `a` |
| `["*","!c"]` | `["a"]` | `a b` | `b` |
| unset | `["b"]` | `a b c` | `a c` |
| `[]` | `["B*"]` | `a b c` | `a c` |

Nested file-based container `Parent` resolves to `Parent (one)` and `Parent (two)`, both with ancestor `Parent`, plus sibling `c`. Clearing the filter always returns all three leaves. Under configured `["c"]`, `["!Parent"]`, `["P*"]`, `["Parent (one)","c"]`, and no filter, `unknownExclusions` accepts both `Parent (two)` and `pArEnT*`, and reports only `nope`. Excluding one existing leaf never produces a false unknown note. Under `["P*"]`, excluding `Parent (two)` retains only `Parent (one)`.

### Resolution failures and bounded cost (proven by instrumentation and probe)

A config that throws `review-371-broken-config` rejects ordinary `createVitest` and adapter startup with the same message. Adapter startup does not fall back to bare exclusions or create a wider instance. Instrumenting only this adapter's real VitestNode methods records:

```text
empty exclude list: createVitest; no extra resolveConfig call
nonempty exclude list, no configured filter: resolveConfig({root,watch:false}), then createVitest
nonempty exclude list, configured filter: resolveConfig({root,watch:false}), then resolveConfig({root,watch:false,project:[]}) beside createVitest
```

This is one extra resolution without a configured filter, two with one; bounded per start/recreation. The coordinator clarified during review that the brief's one-resolution ceiling was a mistake, and the repair notes and D11 are the cost contract. N1's old claim of no added latency is corrected in the 001-349 and 001-370 notes. The first resolution is sequential; startup also awaits the unknown check. Config code and plugin resolution still run for excluded declarations, without creating their test servers.

### Mid-session recreation and S1's digest distinction (proven by adapter probe)

The five-project fixture initially lists five files. Changing the getter to `["e2e"]` and invalidating `squeal.config.json` returns the old/new union of all five project names and lists four files. All four surviving environment digests change once. Repeating the same policy-file invalidation returns no recreated projects, leaves those digests byte-identical, and makes no new startup calls. Editing the excluded e2e config also recreates nothing, changes no survivor digest and leaves the four-file listing. Reinclusion restores the e2e listing and hashes its current config bytes.

D11 now says a remaining project re-keys only when its environment inputs change. The new test calls the real `environmentHash` with fixed core inputs and fixture bytes, checking file-based e2e exclusion changes the server digest and inline web exclusion does not. Both digest tests pass on the candidate and on the two-file baseline, as expected: S1 corrects the promise, rather than changing the existing key behavior.

### S2 and the reused policy contracts (proven by source, probe and tests)

Status and the primer share `excludedProjectsText` in `src/core/text.ts:17`. Literal `e2e` stays `project "e2e"`; `E*` becomes `projects matching "E*"`; mixed entries retain both labels. A named ancestor still names a real declared container, as accepted in the repair notes. The unknown-name function signature, exact index/name message and `vitest.excludeProjects` key path remain unchanged for 005-57. A loader probe preserves the exact messages `"vitest.excludeProjects" must be an array of strings, got "e2e"` and `"vitest.excludeProjects" must be an array of strings, got ["e2e",3]`, applying `[]` for both wrong types. Status and both harness primer tests pass, including literal, wildcard and mixed selectors.

### Versions, key pin and bundles (proven by build, independent hash and tests)

All four requested version files say `0.1.168`. The build produces no tracked bundle drift. Key format remains unreleased format 9; its candidate pin is `e6f3693e86995adcb0adf814d6a4907a4bb265f0ac866ca8073724345c6627b3`. The independent `keySourcesHash()` probe computes that exact digest. The format guard tests pass. The repair notes' pre-integration hash is context, not the integrated candidate's hash.

### Scheduler/store replay (proven with real runners and a private fixture repository)

The source path remains policy reload inside `rekeyContent`, followed by adapter invalidation, environment refresh and `applyListing`. A real composite of Vitest and node:test, the real scheduler and a fixture-private SQLite store repeat the prior review's boundary check:

```text
baseline: 6 file keys, 12 current check rows, no scheduler errors
exclude e2e: 5 file keys, 10 current check rows; no e2e key or known state
unchanged list with new policy formatting: same 5 keys, no additional run
browser-only edit while excluded: same 5 keys, no additional run
  tellUncovered: ["src/browser-only.ts"]
reinclusion: 6 file keys, 12 current rows; changed e2e key and expected assertion fail
native key at all five snapshots:
  220fd781ca1dad23831c37efa9de3227da756ad30d71071dc39b9a117108b844
scheduler errors at every snapshot: []
```

The four retained Vitest keys change once on exclusion, remain identical through the unchanged-list and uncovered-edit revisions, and reuse their valid baseline keys on reinclusion. The native key never moves. Reincluded e2e runs twice under its new key (ordinary run and failure confirmation), rather than reusing the former pass. Every probe instance, private store and fixture repository is closed and removed afterward.

## Inputs for the next wave

No repair wave is required for this narrow re-review. Keep policy reload before invalidation, return the old/new project-name union, and preserve 005-57's key path and message contracts. The observed resolution cost matches the corrected brief and repair notes. Fold the lockfile root-version update into the next version/build commit.
