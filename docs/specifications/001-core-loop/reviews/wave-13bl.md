# Wave 13bl: review 001-369 of 001-349

Candidate: `58eff841f71af0699108f6bf574feea2ff00cef2` (0.1.164). Review scope: the eight contiguous 001-349 commits, `e1c4faad` through coordinator build `58eff841`, against spec 001 D3, D4, D7, D9 and D11. No product file or board edit.

## Verdict

FAIL: one proven blocker, two proven should-fix items and one proven nit. The project filter itself works on the five-project fixture and on nested projects. The unknown-name checker does not always resolve the same universe of projects as that filter.

## Verification

HEAD was pinned detached to the exact candidate. The tracked tree was clean before checks and after the build. `npm ci`, lint, typecheck and build exited 0. The sole independent full-suite run started on that clean candidate; a report-only partial commit was made while it ran, then HEAD returned to the candidate. No source, test, config or bundle changed during verification. The independent suite exited 0: 495 files passed, one skipped; 4,137 tests passed, 38 skipped. The tracked tree remained clean at the candidate after it ended.

Every validation command and probe used a temporary HOME, CODEX_SESSION_ID unset, GIT_CONFIG_GLOBAL=/dev/null and GIT_CONFIG_NOSYSTEM=1. No third-party agent tooling or eval runner was invoked. Fixture probes used copies under this worktree's ignored `test/fixtures/vitest/.tmp/`, private stores and, where needed, private fixture repositories; copies were removed after each probe. No pre-existing daemon or store was inspected or controlled. The independent suite is the review gate required by the brief and reviewer skill, rather than a Squeal checkpoint.

Command prefix (the task's temporary directory is abbreviated here):

```sh
env -u CODEX_SESSION_ID HOME=<temporary-home> GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
```

Outputs:

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

> squeal@0.1.164 lint
> biome check .

Checked 1065 files in 2s. No fixes applied.
exit 0
```

```text
$ npm run typecheck

> squeal@0.1.164 typecheck
> tsc --noEmit
exit 0
```

```text
$ npm run build

> squeal@0.1.164 build
> tsc -p tsconfig.build.json && npm run build:plugin


> squeal@0.1.164 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
exit 0
```

```text
$ npx vitest run --maxWorkers=4

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/587d1a95-ae14-42e6-8992-af46b7fe4bf2

repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/587d1a95-ae14-42e6-8992-af46b7fe4bf2/test/fixtures/scheduler/.tmp/ed42c671-1773-427c-8034-0b41c2f38520/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/587d1a95-ae14-42e6-8992-af46b7fe4bf2/test/fixtures/scheduler/.tmp/3a4b3a5d-fd19-48c6-99d9-f832985e64f0/main/.git/worktrees/staged/gitdir
squeal tests: killing 1 process(es) an earlier run left: 812495
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  495 passed | 1 skipped (496)
      Tests  4137 passed | 38 skipped (4175)
   Start at  13:24:02
   Duration  947.17s (tests 97%, import 2%, transform 1%)

    Isolate  496 workers spawned · ~280ms startup each (spawn + environment, per file)
             at least ~34.45s faster with isolate: false — reuses workers across files instead of one per file
exit 0
```

```text
$ git rev-parse HEAD
58eff841f71af0699108f6bf574feea2ff00cef2
$ git status --short
(no output)
$ git diff --exit-code -- plugins/claude-code/dist plugins/codex/dist
(no output; exit 0)
```

## Blockers

### B1. The unknown-name checker retains the config's own project filter (proven)

`src/runners/vitest/exclude.ts:32` calls `resolveConfig({ root, watch: false })`. Contrary to its comment, this is not always unfiltered: a config's `test.project` survives. Vitest filters before returning `test.resolvedProjects`. The actual adapter supplies an explicit `project` option at `src/runners/vitest/adapter.ts:170`, which replaces that configured filter.

Reproduction with Vitest 5.0.3:

```ts
// vitest.config.ts
export default {
  test: {
    project: ["a"],
    projects: ["a", "b", "c"].map((name) => ({
      test: { name, include: ["*.test.ts"] },
    })),
  },
};
// squeal.config.json
// { "vitest": { "excludeProjects": ["b"] } }
```

The adapter lists `a` and `c`, correctly excluding `b`, but emits:

```text
squeal.config.json: "vitest.excludeProjects[0]" names no Vitest project ("b"); it is left out
```

Captured probe output:

```text
{"name":"config-filter","excluded":["b"],"files":[{"project":"a","path":"a.test.ts"},{"project":"c","path":"a.test.ts"}],"envs":["a","c"],"notes":["squeal.config.json: \"vitest.excludeProjects[0]\" names no Vitest project (\"b\"); it is left out"]}
```

The validator sees only `a`; `b` exists and the actual exclusion matches it. This breaks D11's rule that a name matching no project is reported, and the brief's explicit requirement that the checker never disagree with the filter. 005-57 will also reuse this checker and message. Negative config filters have the same root cause.

Fix in one worker: explicitly clear the project option for name resolution (`project: []`), verifying that the resulting call enumerates every candidate name and ancestor. Add positive and negative configured-filter regressions. Preserve the pinned message and use the complete name set for the existing wildcard matcher.

## Should-fix

### S1. D11 promises a re-key for an exclusion that may change no environment (proven)

`docs/specifications/001-core-loop/spec.md:201` says changing the list “re-keys the remaining projects once.” The five-project probe excludes the inline `web` project. The instance is recreated, but the surviving `server` environment is byte-for-byte identical: its resolved config and files remain the same (`e2e/vitest.config.ts`, `vitest.config.ts`). With identical environment and closure inputs, its key does not change. The scheduler's `setEnvironments` correctly does not manufacture a change.

This is a documentation overstatement, rather than stale reuse: the surviving project's inputs really are identical. Amend D11 to say survivors re-key when the surviving environment inputs change. The file-based e2e exclusion does change those inputs and re-keys the other four once. Add a meaningful key-digest assertion for both forms if this distinction is to remain a promised behavior; the new adapter test checks only resolved config equality.

### S2. Patterns are printed as if they were actual project names (proven)

`src/core/status/snapshot.ts:140` and `src/harness/shared/coverage.ts:64` copy the list as written. `src/core/status/format-status.ts:85` and `src/harness/shared/primer.ts:122` label each string a project. With `["E*"]` excluding `e2e`, output is:

```text
Squeal covers Vitest (vitest.config.ts); its project "E*" is not run, excluded by squeal.config.json.
Not run: Vitest project "E*", excluded by squeal.config.json
```

No project is named `E*`. Literal names satisfy D11 and the fixture's done-when, but wildcards and ancestor selectors do not identify each excluded leaf. This is nonblocking wording for an operative filter, not a false green. Give patterns an explicit filter label; if D11 intends actual excluded project names, carry the resolved matched names to status and delivery after listing. Before resolution, identify the policy's selectors as selectors. Keep the literal-name contract for 005-57.

## Nits

### N1. The second resolution may add startup latency (proven)

`tasks/001-349/notes.md` says the parallel resolution “adds CPU but no latency.” `src/runners/vitest/adapter.ts:189` awaits its completion before startup returns. Parallel launch reduces the added delay, but a slow second resolution can still extend startup. Correct the note to say it duplicates config evaluation for each nonempty-list start/recreation and may extend startup. Both calls resolve all declared configs; excluded projects' config code and config plugin hooks still execute, even though their test servers and global setup do not.

## What fits

- **Project selection (proven by source and probe):** Vitest 5.0.3's `node_modules/vitest/dist/chunks/index.DpLw24bj.js:12482` resolves declarations, flattens nested file-based containers and expands browser/benchmark entries, then applies the filter at `:12551`. `matchesEntryFilter` at `:13160` checks names and ancestors; `wildcardPatternToRegExp` at `:5966` is the same anchored, escaped, case-insensitive matcher as `exclude.ts:56`. `attachProjectsFromEntries` at `:13277` attaches servers only to retained entries. The five-project fixture has no e2e environment or listed file after exclusion, and the real fast and slow runs leave `e2e/booted` absent.
- **Nested names (proven):** the nested container `Parent` resolves to `Parent (one)` and `Parent (two)`, each with ancestor `Parent`. Both `pArEnT` and `P*` drop both children with no unknown-name note; `Parent (one)` drops only that child. An absent selector gives the pinned warning. Apart from B1's incomplete universe, the matcher agrees with Vitest. Browser-parent handling was read in source (`expandBrowserInstancesInEntries` at `:12963`); no browser provider or real browser was launched.
- **Policy messages (proven):** wrong types produce exactly `"vitest.excludeProjects" must be an array of strings, got "e2e"` and `"vitest.excludeProjects" must be an array of strings, got ["e2e",3]`. The list defaults to `[]`, and the index/name spelling of the unknown message is unchanged. The validator's second resolution occurs only with a nonempty list, at every instance start; it creates no test project.
- **Mid-session changes (proven by adapter and real scheduler/store probes):** the policy reload precedes invalidation. Recreation returns the union of old and new project names; refinement reads environments and listing again. Starting with five Vitest files plus a native node:test file gives 12 current check rows. Excluding e2e yields five key rows and 10 current check rows, with no e2e key or known state. The other four Vitest keys change once, the native key stays the same, and a later excluded-config edit changes neither surviving environment nor listing. A revision leaving the list unchanged recreates nothing. `applyListing` retires removed files, and subsequent tiers do not run them.
- **Uncovered changes and reinclusion (proven):** a changed `src/browser-only.ts` after exclusion triggers no run and `tellUncovered` returns that exact path. Reinclusion keys the new bytes and finds the expected e2e assertion failure; it does not reuse the former pass. The unchanged retained projects may reuse their earlier valid keys when the environment returns to its former value. There is no continuing re-key loop.
- **Slow and node:test lanes (proven by source and probe):** daemon fast and slow factories both read the exclusion getter. The `withSlowInstance` probe creates one slow instance, runs the four retained Vitest projects successfully and never boots e2e. Node:test receives no new option, and its key/result stays current through ordinary Vitest exclusion and reinclusion. Excluding every Vitest project is the explicit runner-failure exception: the existing composite's whole-call rejection marks all existing worktree checks unknown, including node:test. This behavior predates the diff and is not a separate finding.
- **Every project excluded (proven):** `['*']` over declared projects rejects with “No projects were found … The filter matched no projects: !*.” The sole named root project rejects with `No projects matched the filter "!only".` In the mid-session scheduler probe, all 12 existing checks become unknown and no background error escapes. This is a runner failure, not a crash of Squeal or a quiet successful checkpoint.
- **Status and primer (proven):** literal exclusions are named in both harness primers and in status using the exact new text. The Vitest-detection gate is the daemon's existing rule. S2 is the wildcard wording gap.
- **Keys and bundles (proven):** guarded adapter/policy behavior changed, so the global format guard must be re-pinned under the not-yet-released format 9. The last recorded release, 0.1.131, shipped format 8; updating the unreleased 9 entry is appropriate. The independent hash probe computes `535feb185483120d2f5a0ae0c0364b8e0e5f0d61a5e80ff42f8b5c6c8039e316`, exactly the candidate's pin. All four version files say 0.1.164. `npm run build` produces no tracked bundle drift in either plugin.

## Inputs for the next wave

1. Repair B1's name universe before 005-57 adopts `unknownExclusions`. Keep the key path and both exact message contracts. Use Vitest's `resolveConfig` without a configured project filter; do not create excluded test projects to learn their names.
2. Keep reload before invalidation and return old/new project-name union, so refinement re-lists before tiers resume. Removed files must retire their checks and keys; newly included files must key current closure bytes.
3. Fold S1 into D11's wording and decide whether S2 should show selector labels or persist resolved excluded names. N1 needs only a wording correction.
4. Add regressions for configured-filter validation and actual scheduler retirement/reinclusion if extending the focused adapter tests. No new product change is needed for the verified ordinary exclusion, uncovered-edit, slow-lane or key-pin paths.
