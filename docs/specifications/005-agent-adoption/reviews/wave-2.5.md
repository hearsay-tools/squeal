# 005 wave 2.5 re-review

PASS `3dc61b4d5774a224d43d68320707290983d9e3dc`: **0 blockers**, **1 proven nonblocking should-fix**, **0 nits**. Wave 2 B1, B2, B3 and S1 are closed. The remaining note is in 005-29: ignored-read suggestions discard another project's entry when two projects run the same file.

## Verification

HEAD matches the assigned HEAD candidate. This is the bounded 005-30 re-review against `reviews/wave-2.md`, `tasks/wave-2.md`, D3/D8 and the 2026-10-13 wave 2.5 amendment. Compared `6629ba45..3dc61b4d`, and inspected the named repairs individually: `72ebee8e`, `56f1353c`, `09f5ceb2`, `ca404d32`, `83f7f739`, `6f417490`, `27e0ec87`, `a775a730`, and the 0.1.138 build `60c12a0c`. Some installer/listing repair content is already present at the left endpoint; the named commits and HEAD probes cover those repairs too. Intervening 001/006 work is excluded.

All checks ran at that commit with a clean tracked tree, before writing this review. `npm run build` left both committed plugin distributions unchanged. No source or board edits, no delegation, no real Claude/Codex CLI and no model session. The independent probes used scratch homes, stub CLIs and file:// hubs. Their Vitest root/config/cache lived in `/home/agent/.cache/review-005-30`, never `/tmp`. Fixture helpers create their own isolated scratch directories. `/tmp/node_modules` was absent before and after the probes.

```text
$ git rev-parse HEAD
3dc61b4d5774a224d43d68320707290983d9e3dc
(exit 0)

$ npm ci
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

added 56 packages, and audited 57 packages in 2s

18 packages are looking for funding
  run `npm fund` for details

found 0 vulnerabilities
npm warn install-scripts 2 packages have install scripts not yet covered by allowScripts:
npm warn install-scripts   @parcel/watcher@2.6.0 (install: node scripts/build-from-source.js)
npm warn install-scripts   esbuild@0.28.2 (postinstall: node install.js)
npm warn install-scripts
npm warn install-scripts Run `npm install-scripts ls` to review, or `npm install-scripts approve <pkg>` to allow.
(exit 0)

$ npm run lint
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.138 lint
> biome check .

Checked 977 files in 6s. No fixes applied.
(exit 0)

$ npm run typecheck
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.138 typecheck
> tsc --noEmit
(exit 0)

$ npm run build
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.138 build
> tsc -p tsconfig.build.json && npm run build:plugin

npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

> squeal@0.1.138 build:plugin
> tsx src/harness/claude-code/build.ts && tsx src/harness/codex/build.ts
(exit 0)

$ git status --porcelain
(no output)
(exit 0)

$ node node_modules/vitest/vitest.mjs run --config /home/agent/.cache/review-005-30/config.mjs
RUN  v5.0.3 /home/agent/.cache/review-005-30

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  14:07:38
   Duration  13.92s (tests 64%, transform 31%, import 5%)

  Transform  transforming modules took 4.13s · 31% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns
(exit 0)

$ node node_modules/vitest/vitest.mjs run --config /home/agent/.cache/review-005-30/config.mjs -t "005-29 nearest variant" --reporter verbose
RUN  v5.0.3 /home/agent/.cache/review-005-30

stdout | probes.test.ts > 005-29 nearest variant: two pools read different ignored artifacts
005-29 variant: first pool has dist/a.js, second has dist/b.js; output names only dist/a.js and omits dist/b.js

 ↓ probes.test.ts > B1 independent real Vitest list and both public hooks; blocked slot stays available
 ↓ probes.test.ts > B2 every proper final-line prefix is inert for install and uninstall
 ↓ probes.test.ts > B3 original plugin-first claude survives repeated install/uninstall
 ↓ probes.test.ts > B3 original plugin-first codex survives repeated install/uninstall
 ↓ probes.test.ts > S1 fresh: instruction additions shown once without staging
 ↓ probes.test.ts > S1 separate: instruction additions shown once without staging
 ↓ probes.test.ts > S1 symlink: instruction additions shown once without staging
 ✓ probes.test.ts > 005-29 nearest variant: two pools read different ignored artifacts 5ms

 Test Files  1 passed (1)
      Tests  1 passed | 7 skipped (8)
   Start at  14:09:01
   Duration  3.71s (transform 85%, import 15%)

  Transform  transforming modules took 3.02s · 85% of tracked time, re-done on every run
             persist transforms across runs with fsModuleCache: true
             learn more: https://vitest.dev/guide/improving-performance#caching-between-reruns
(exit 0)

$ node node_modules/vitest/vitest.mjs run test/cli/warmup.test.ts test/cli/warmup-reads.test.ts test/harness/latency.test.ts test/runners/vitest/test-command-files.test.ts test/cli/install-sh-uninstall.test.ts --maxWorkers=1
RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5e23f46e-66cb-4dc0-870d-9d6af1687347

Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

 Test Files  5 passed (5)
      Tests  22 passed (22)
   Start at  14:08:21
   Duration  78.96s (tests 93%, transform 5%, import 1%)
(exit 0)

$ npx vitest run
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5e23f46e-66cb-4dc0-870d-9d6af1687347

 ❯ test/watcher/linked-exclusions.test.ts (8 tests | 1 failed) 9941ms
   ❯ the watch of a linked directory's target (5)
     × stops watching an install made after the watch started 4505ms
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/5e23f46e-66cb-4dc0-870d-9d6af1687347/test/fixtures/scheduler/.tmp/dde10bd3-593f-4b03-861b-c812fdd4d91f/main/.git/worktrees/staged/gitdir
repair: gitdir incorrect: /home/agent/projects/squeal/.ai/cezar/worktrees/5e23f46e-66cb-4dc0-870d-9d6af1687347/test/fixtures/scheduler/.tmp/ac85e91e-4186-43fe-910f-9cb426a19212/main/.git/worktrees/staged/gitdir
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
squeal tests: killing 1 process(es) an earlier run left: 3818875
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.
Testing types with tsc and vue-tsc is an experimental feature.
Breaking changes might not follow SemVer, please pin Vitest's version when using it.

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  test/watcher/linked-exclusions.test.ts > the watch of a linked directory's target > stops watching an install made after the watch started
Error: condition not met in 3000 ms
 ❯ waitFor test/watcher/helpers.ts:43:47
     41|   const start = Date.now();
     42|   while (!check()) {
     43|     if (Date.now() - start > timeoutMs) throw new Error(`condition not…
       |                                               ^
     44|     await delay(20);
     45|   }
 ❯ test/watcher/linked-exclusions.test.ts:135:5

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯


 Test Files  1 failed | 454 passed | 1 skipped (456)
      Tests  1 failed | 3820 passed | 10 skipped (3831)
   Start at  14:10:06
   Duration  363.92s (tests 94%, import 3%, transform 3%)
(exit 1)

$ npx vitest run test/watcher/linked-exclusions.test.ts
npm warn Unknown env config "store-dir". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options.

 RUN  v5.0.3 /home/agent/projects/squeal/.ai/cezar/worktrees/5e23f46e-66cb-4dc0-870d-9d6af1687347


 Test Files  1 passed (1)
      Tests  8 passed (8)
   Start at  14:16:17
   Duration  3.03s (tests 94%, transform 4%, import 1%)
(exit 0)

$ git status --porcelain; git diff --check
(no output)
(exit 0)

$ test ! -e /tmp/node_modules
(no output)
(exit 0)
```

The full independent suite is **red**, not replaced by a Squeal checkpoint or a second full run. Its only failure is the unchanged watcher timing check at `test/watcher/linked-exclusions.test.ts:135` (`condition not met in 3000 ms`). The coordinator identified it as known row 001-309 item (3) and requested one isolated rerun with no further investigation. That file passes alone, 8/8. This is recorded verification evidence, not a new finding against wave 2.5; the isolated pass does not erase the full-suite failure. The Git repair/typecheck/stray-process diagnostic lines above are retained as emitted. No check was unable to run.


## Blockers

None. The three prior blockers no longer reproduce.

### B1 closed: a partially covered command runs without spending its once slot

The independent probe repeated the original mixed ordinary/typecheck configuration and compared real `vitest list --filesOnly` with the adapter and scheduler listing. Vitest names `test/outside.test-d.ts` as well as four ordinary files. Squeal lists four, records `omittedTestFiles = 1`, and both public PreToolUse hooks return no denial. Both consumers' once slots remain unused. The existing positive tests retain a one-time denial for a complete ordinary listing, then allow the second command.

The runner wrappers forward `omittedTestFiles()`. Successful bootstrap, revision and refinement listings call `listTestFilesOf`, which records the count. D8 reads it in the same transaction as currentness and the once record. Null/nonzero counts fall through; no runner or config evaluation occurs inside the hook. Structural invalidation clears Vitest's cached typecheck listing; the added-typecheck-file test exercises that boundary. The opt-in flag remains before store work, with its hook latency test passing.

### B2 closed: executable prefixes of the final invocation are inert

The final line is `main "$@" squeal-install-complete`. Its token follows the user arguments. `main` checks completeness before setting resource paths or selecting a mode. The independent scratch-machine probe ran every proper prefix of that invocation for both install and uninstall, including `main`, `main ` and `main "$@"`: no harness calls and byte/mode-identical scratch homes. The uninstall case began with an installation it could have removed. Complete installs still succeed.

### B3 closed: plugin-first installation is preserved by uninstall

The original plugin-first probe passes for Claude and Codex separately, including a repeated installer invocation. Install makes no harness calls for the pre-existing plugin; uninstall makes no removal call, retains the plugin, explains why it stays, and removes the launcher this installer created.

The installer records each created resource immediately in `${XDG_STATE_HOME:-$HOME/.local/state}/squeal/installed`, outside both harness config directories. The focused ownership tests also cover a mixed machine, a pre-existing launcher, repeated installs, recovery after one harness fails, and a missing harness at uninstall. Harness config writes remain the stub harnesses' own CLI work. The expanded 30 s test budget passes the focused run; the full-run result is recorded above.

## Should-fix

### S2. Proven, nonblocking: a second project's ignored reads disappear from the suggestions

**Location:** `src/cli/warmup.ts:174`; callers at `src/cli/warmup.ts:81` and `src/cli/setup/flow.ts:76`.

**Contract:** 005-29: “print each slow file's ignored paths as unkeyed suggestions for inputs”; D3's warm-up reports the ignored paths a slow file read. This is a new note in a bounded re-review, not a reopening of any prior blocker.

**Failure scenario:** two Vitest projects/pools run the same slow file. The stored record correctly holds distinct per-project reads. `slowFileReads` indexes output by path and keeps only the first project's entry, dropping the other project's paths and overflow. Both standalone warm-up and setup use that result. A user following its suggestions can miss an unkeyed artifact.

**Independent discriminating probe:**

```ts
const path = "test/e2e/build.test.ts";
const record = {
  checkpoint: "c1", revision: 3,
  files: {
    [`a\0${path}`]: { paths: ["dist/a.js"], more: 0 },
    [`b\0${path}`]: { paths: ["dist/b.js"], more: 0 },
  },
};
const found = slowFileReads(record,
  [{ project: "a", path }, { project: "b", path }], () => true);
// found.reads is [{ path, paths: ["dist/a.js"], more: 0 }].
// ignoredReadText(found.reads[0]) names dist/a.js and omits dist/b.js.
```

The probe passes by asserting this omission against HEAD. It proves the formatter's loss from a valid record; it is not a claim that a real two-pool daemon session was run. Existing `warmup-reads.test.ts` covers only one recorded pool of a duplicate path, so it cannot catch this.

**One-worker fix:** preserve every recorded project's paths and `more` when grouping one physical path. Keep per-project capped lists/counts under that path, or explicitly name the project for each suggestion. Do not claim an exact unique union count when hidden overflow makes it unknowable. Missing records must retain uncertainty. Own `src/cli/warmup.ts` and focused warm-up tests; change no scheduler or store contract. Done when disjoint reads from both projects appear in standalone and setup output, with caps/overflow and no automatic inputs declaration.

### S1 closed: new instruction files appear in the diff and commit list

Independent fresh, separate and symlinked fixtures all show each new file's diff and list its path exactly once. The symlink itself and its target are separate Git additions, each shown once; the managed block appears only in the target. No file is staged. `showChanges` includes the actual selected block paths, asks Git for untracked instruction paths, and uses `diff --no-index /dev/null` for their additions. Existing tests also cover a tracked file alongside a new file and a new target behind an already tracked symlink.

## Nits

None. Board/status match the candidate's repair/build state and identify 005-30 as running. No drift repair is part of this review.

## What fits

- Prior wave-2 conclusions remain settled; this review did not revisit launcher selection, command recognition, gate rewriting or unrelated architecture.
- D8's new omission count is conservative, per worktree, with absent/nonzero rows allowing the command and preserving its once slot. The ordinary fully covered positive case remains in the suite.
- Installer completion validation precedes side effects. Ownership persists across repeat/partial installs, and pre-existing harness plugins survive uninstall.
- Setup displays new instruction files read-only and names their Git additions once.
- `warmUp` calls `runCommand(["--all", "--wait"], io, { observeIgnored: true })`; ordinary CLI `run --all` has no public observation flag. Standalone and setup share that seam.
- The real-daemon ignored-read test passes: plain `run --all --wait` stores no record; after the slow file is made stale, warm-up records `build/out.txt` and names it as unkeyed, with config bytes unchanged. The private test build now copies all three observe `.cjs` files, matching the shipped build.
- Capped suggestions retain stored paths and `more`. Missing-record wording matches the dated interim amendment: not observed or no reads, rather than claiming a clean observation. It must narrow only after 001-312 lands.
- Lint/typecheck/build pass, with no bundle drift or new dependencies.

## Inputs for the next wave

| Work | Contract to preserve | Done when |
| --- | --- | --- |
| S2 ignored-read grouping | One worker on warm-up formatting and tests. Retain per-project evidence while naming the physical file clearly. Observe through the internal third `runCommand` argument, never a user-facing flag. Preserve caps, truthful overflow and missing-record uncertainty. | Both projects' disjoint paths and overflow reach standalone/setup output; no config write or automatic input declaration. |
| 001-312 follow-through | Coordinate the amendment's wording change with that owner's landing: observing requests never join and every observed file gets an entry. Do not narrow uncertainty before the corresponding daemon contract exists. | A recorded empty entry says no ignored read; an absent entry says not observed; cold and current-file warm-ups have discriminating tests. |
| Remaining 005 skill/text/proof rows | Keep 005-15/19/17/18 in their own briefs. Hooks stay opt-in, before-store fast path unchanged; p95 budget remains under 10 ms. Installer checks use scratch homes and stub CLIs. | Those rows' own proof and budgets, with independent reviewer/landing/CI runs retained. |

No mandatory fix wave is needed to close B1, B2, B3 or S1. The coordinator decides whether the new nonblocking note joins the next wave.
