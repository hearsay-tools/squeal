# Review of waves 4 to 6 (005-42)

Initial findings written 2026-10-14 06:58 UTC, within 15 minutes of starting; extended and finalized at 07:06 UTC.

## Verification

Requested range: `00c98842..8dfe244d`, only commits matching `git log --grep '00[5]-'`. Checkout at verification start: `3cd299ee6527e06f76fe8eadded020f564a03625`. Its sole delta from the endpoint is the review brief and board row; product and tests match `8dfe244d`. Exact-endpoint broad verification is **unverified** under the reviewer rule. The full suite started on a clean tree; only this review document was authored during it, and no product/test file changed. No verification failure is a blocker in itself. No broad check failed.

Routine verification output (npm notices retained below):

```text
$ git rev-parse HEAD
3cd299ee6527e06f76fe8eadded020f564a03625
$ git status --short
(empty before verification)
$ npm ci
added 56 packages, and audited 57 packages in 3s
found 0 vulnerabilities
(exit 0; npm warned about store-dir and unapproved optional install scripts)
$ npm run lint
Checked 1000 files in 6s. No fixes applied.
(exit 0)
$ npm run typecheck
> tsc --noEmit
(exit 0, no diagnostics)
$ npx vitest run --maxWorkers=4
RUN v5.0.3
Test Files  469 passed | 1 skipped (470)
     Tests  3956 passed | 9 skipped (3965)
  Start at  08:55:25
  Duration  639.00s (tests 97%, import 2%, transform 1%)
(exit 0; exactly one full run)
```

npm's notices were:

```text
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
```

`npm run build` was omitted by the explicit task instruction. Bundle rebuild/drift is **unverified**. No real CLI, model session, real-home config read, real-CLI suite or command as `squeal-e2e` was run. The normal Vitest include matches `.test.ts`, while the real-CLI cases end in `.real.ts`.

Both failure scenarios were also reproduced against the exact endpoint's unmodified source, exported with `git archive 8dfe244d` into `/tmp/005-42-candidate` and using the installed dependency tree. Both produced the same outputs recorded under the blockers. Those probes do not run Vitest, test/real-cli, model sessions or artifacts, and write only scratch fixtures. The proof is the source seam and concrete outputs, independent of broad verification at the documentation-only child.

The full run also printed two `repair: gitdir incorrect` notices for scratch scheduler worktrees, a cleanup message about one process left by an earlier run, and Vitest's experimental typecheck warnings. It still exited 0. The separate Squeal background baseline reported two warm-up test failures and then their recovery under the same inputs; those are not the independent-run verdict and were not promoted to blockers.

## Verdict

**FAIL `8dfe244d`: 2 proven blockers, 1 plausible should-fix, 1 proven nonblocking checkout note.**

## Blockers

### B1 (proven): excluded node:test files validate a declaration that runs nothing

**Location:** `src/cli/setup/test-globs.ts:18` (new universe), `src/cli/setup/plan.ts:251` (the seam drops `exclude`).

**Contract:** 005-42 requires “Setup never writes a config that silently selects nothing” and “`--check` agrees with what is written.” Row 005-40 requires refusal of a slow or input test glob that selects no test file. `NodeTestProject.exclude` removes files from the project's `include`.

**Failure:** the new `testFileUniverse` unions every tracked path matching a project's includes, without exclusions. The node:test runner uses includes minus exclusions (`src/runners/node-test/adapter-files.ts:22`). Even without a daemon, setup validates a file the only applicable runner excludes, writes both entries and then reports nothing outdated.

**Cheap reproduction:** run a TypeScript scratch probe with `tsx`, no Vitest or subject process. Use `cezarionShaped` with a Vitest config selecting only `src/**/*.test.ts`, and this tracked config:

```json
{
  "slow": {"include": []},
  "nodeTest": [{"name": "unit", "cwd": "packages/cezar", "include": ["test/unit/*.test.ts"], "exclude": ["test/unit/a.test.ts"]}],
  "inputs": {}
}
```

Call the real runner's `listTestFiles(root, loadPolicy(root).policy.nodeTest[0])`, `readPlan`, then `main(["init", "--harness", "codex", "--block", "none", "--slow", "packages/cezar/test/unit/a.test.ts", "--input", "packages/cezar/test/unit/a.test.ts=packages/cezar/dist/**"], scratchIo)` and `main(["setup", "--check"], scratchIo)`. Only fake/no harness CLIs are in `scratchIo.env`.

```text
actual node:test files: []
validation universe: ["packages/cezar/test/unit/a.test.ts"]
init exit: 0
written slow.include: ["packages/cezar/test/unit/a.test.ts"]
written inputs: {"packages/cezar/test/unit/a.test.ts": ["packages/cezar/dist/**"]}
check exit: 0
Nothing is outdated.
```

**One-worker fix:** retain project exclusions at the setup/runner seam and subtract them per project before constructing the validation universe. Use that same effective set for `init`, setup application and `--check`. Add a regression with an included-but-excluded file that no other runner lists: both write paths exit 1 without writes, and a pre-existing declaration makes `--check` exit 1. Preserve files genuinely listed by another project or runner.

### B2 (proven): an unrelated tracked suffix hides an explicit root-artifact import

**Location:** `src/cli/setup/artifacts.ts:188` (`names`, the tracked-suffix veto); resulting default at `src/cli/setup/questions.ts:204`.

**Contract:** 005-42: “The default input never leaves out the artifact the evidence names.” Row 005-38 ranks a candidate named by a test string before package/build evidence and existence. D3: “an input too narrow leaves a result current after a change it misses, the costliest failure.”

**Failure:** `names` first finds that a string resolves under the candidate, then strips leading `../` and rejects it whenever an unrelated tracked file ends with the stripped suffix. A test's `import("../../dist/cli/squeal.mjs")` under `test/e2e` unambiguously reaches root `dist`, but the tracked `plugins/codex/dist/cli/squeal.mjs` vetoes it. A second string naming that plugin gives `plugins` the first rank. The default becomes only `plugins/**`, so rebuilding the explicitly imported root artifact does not invalidate the group's result.

**Reproduction:** `squealShaped` with empty config, replace `test/e2e/plugin-copy.test.ts` with the import above plus `const bundled = "plugins/codex/dist/cli/squeal.mjs"`, and replace `shipped-plugin.test.ts` with `export {};`. Create ignored `dist/cli/squeal.mjs`. Read `buildPlan` and take every default with `answerPlan`. No artifact or test is executed.

```text
explicit import resolves: dist/cli/squeal.mjs
candidate evidence: [{"path":"dist","rules":["bin","files","build-script"]},{"path":"plugins","rules":["files","named"]}]
default: plugins/**
default inputs: [{"test":"test/e2e/**","input":"plugins/**"}]
```

**One-worker fix:** qualify the ambiguous-suffix safeguard by the base that actually resolved the string. An explicit file-relative path reaching root `dist` must remain named regardless of another tracked suffix. Keep 005-38's existing protection for the ambiguous bare `dist/cli/squeal.mjs` string used by the plugin fixtures. Add the explicit relative-path regression alongside that existing negative, pin the evidence and the default (root `dist` outranks `plugins` here), and pin full ties together.

## Should-fix

### S1 (plausible, nonblocking): argv secrecy depends on every caller

**Location:** `test/real-cli/isolated.ts:115` and `:131`.

The guard scans only `s.env` values for credentials; `commandLine` appends `s.cmd` and `s.args` unchecked. A future caller passing a provider token in an argument would pass the guard and expose it in process argv. The current skill-session caller passes credentials by preserve-name and Codex config by stdin, and the examined existing callers pass static commands or scratch paths. No actual credential leak is proven. One-worker follow-up: reject known secrets in command/arguments before spawning and cover the guard with synthetic credentials in a normal unit file, without a subject process or real-home access. Keep provider config on stdin.

## Nits

### N1 (proven, nonblocking): requested endpoint and checkout differ

**Location:** `docs/specifications/005-agent-adoption/tasks/wave-6.md:98` (range), checkout `3cd299ee`.

The brief asks for the endpoint `8dfe244d`; HEAD is its documentation-only child `3cd299ee`. This is the mismatch the reviewer procedure requires reporting. No product defect follows. The coordinator can distinguish the content endpoint from the checkout in later review briefs. The broad verification above is not promoted to exact-endpoint evidence.

## Scope checked

| Rows | In-range changes followed |
|---|---|
| 005-17 | `6189afdd`, `f7e0b209`, `c0ee7220`, `3666cce9`, `14b9b80c`, `20a94891`, `bfa1e3da`: isolated process boundary, scratch machines, install/update/setup assertions, model opt-in, teardown and provider handling |
| 005-38 | `43001da2`, `c7e62953`: string evidence, path qualification, ranking, defaults and ties |
| 005-40 | `8ffd7d30`, `bad5a955`: Codex hint, shared validation and normalization, both write paths, check diagnostics, setup skill syntax |
| 005-39 and 005-41 | `85217cbd`, `5f92ba4a`: load-wait progress and deduplication, ignored-read suggestion clause, matching skill copies |
| Bundle landings | `4f250bad`, `a3e56078`: source reviewed above; rebuilding explicitly forbidden, so drift remains unverified |

001 commits between these changes were excluded from prosecution. No spec review or lessons file was prosecuted.

## What fits

- The setup skill copies compare byte-for-byte, at 4,262 characters each, below 5,000. They name the normalized glob/none syntax and build-output distinction accurately.
- The real-CLI process boundary always calls the guard before sudo, uses the throwaway UID and scratch directories, and passes provider values through environment preservation or stdin. Output redaction is applied before returning or saving session output. This is source review; OS permissions and real-CLI execution remain unverified.
- Normal Vitest excludes real-CLI cases by their filename suffix; the independent run does not load them.
- Outside B2, input ranking implements the approved order: named test string, package/build evidence, then existence; full ties are grouped and a broader parent remains preferred.
- `--input <glob>=none` is omitted rather than written literally. Shared normalization precedes init's harness writes and setup's interview.
- The warm-up counts queued slow files only while recorded activity says load wait, then deduplicates the full rendered progress line.

## Inputs for the next wave

Dispatch B1 and B2 as two repair rows owning the universe/project seam and the artifact evidence respectively. B2 must preserve the ambiguity negative and explicit path positive before considering defaults. Dispatch B1 against setup's project/file-set seam. `readPlan` supplies both the public plan and the private validation universe; `normalizeGlobs` and `unselected` must consume the same effective runner file set. Do not change the node:test adapter's include-minus-exclude contract. The one capped independent full-suite run completed; no second full-suite run was started. Real-CLI and model proof, plus bundle drift, remain outside this task's authorization.
