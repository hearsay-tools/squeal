# Cezar's e2e setup fails and Squeal still runs the tests (row 001-375)

Researcher, 2026-10-14. Squeal at `83e2d4e8` (0.1.174 source and bundles). Cezar read-only at `d3ad245d` (#1019, the change of cezar task daff3d7f), its daemon 0.1.168 (pid 583217, started 18:01:10 UTC), Vitest 4.1.10 there. Times are UTC unless marked local. I ran nothing in cezar. Its store was read from a copy in `/tmp/r375-store`, and its run logs under `.git/squeal/runs/` were read in place. The fixture is `/tmp/r375-fixture` (throwaway, Vitest 5.0.3) with the probe `/tmp/r375-probe/reuse.mjs`. I committed neither, as the brief asks.

## Answers

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| a | Which setup failed, and why | **`globalSetup`**: `packages/web/e2e/environment.ts`, which runs `.ai/scripts/test-env-up.sh` and throws "Browser E2E environment bootstrap failed". The script builds, then starts the test server with `--repo` set to the main checkout. The human's live cockpit (port 4321) holds that checkout's `cockpit.lock`, so the server exits at once ("A cockpit already serves …"), and the script exits 1. Each file's `beforeAll` then reads the stale descriptor `.ai/qa/test-env.json` from 2026-09-12 (`browser.installed: false`, server port 43275 long dead). That read is what produces "provider is not installed" and "fetch failed". Squeal still runs the tests because **Vitest runs `globalSetup` once per instance, and marks it done even when it throws**. Squeal's daemon reuses the instance after that crash, so every later file runs with no setup at all | read in source code (cezar, Vitest 4.1.10, 5.0.3); verified in cezar's run logs; verified by experiment (Vitest 5.0.3) |
| b | What 0.1.168 stored and reported | Three `run --all` checkpoints at revisions 0 and 3 had the same shape: **2 runs crashed** on the `globalSetup` throw, and **73 to 76 completed**. Stored now: **74 browser files `FAIL` (file-level, current)**, 54 with the provider message and 20 with "fetch failed", plus **680 tests `SKIP`**. `agent-browser-tabs.e2e.ts` has no row, because both of its runs crashed. Reported at 18:16: "Known failures: 79 (5 tests, 74 test files that did not load)" | verified (store copy, run logs, daff3d7f transcript) |
| c | Does 0.1.174 change it | **No** (verified by experiment, fixture below). `run.ts`, `adapter.ts` and `broken.ts` are unchanged from 0.1.168 to `83e2d4e8`. A rejected run keeps its instance, so the setup is still skipped. 001-361 only rewords the 74 rows to "setup failed: …" (they are file-level hook errors with skipped tests). The counts stay "74 test files that did not load" until 001-373, and the run-level crash reason still drops `cause` (`describeError`, `run.ts:227`) | read in source code; fixture run below |
| d | What Squeal should do | First fix fidelity, which none of the three options does on its own: **never run a file on an instance whose `globalSetup` threw.** Then take "one setup failure instead of N": a `globalSetup` throw makes the project's files `unknown`, with one line and the cause chain, retried at the next revision or `run --all`. That is D5's runner-failure path, which nothing stores under a key. This is what Vitest does: one startup error, no test run, exit 1 | verified by experiment (Vitest CLI); inferred (policy) |
| e | What is cezar's to fix | The test server in the main checkout collides with the live cockpit. The bootstrap leaves the stale descriptor in place on failure. The specs trust any descriptor without checking that this boot wrote it. The cezar session is already fixing the first two (it chose "Fix both in a PR" at 18:21) | read in source code, cezar transcript |

## (a) The failing setup

The e2e project config (`packages/web/e2e/vitest.config.ts`, #1017 and #1019) sets `globalSetup: ['./environment.ts', './workspace-registry.ts']`. `environment.ts` `setup()` calls `execFile('sh', ['.ai/scripts/test-env-up.sh'])` and turns any failure into `new Error('Browser E2E environment bootstrap failed', { cause })`. If the boot succeeds, it also throws when `browser.installed !== true`.

#1019 moved the e2e build to `.ai/qa/build/cezar` and starts `node $E2E_BUILD_ROOT/dist/index.js --port … --repo "$REPO_ROOT"`. In the main checkout `--repo` is the human's checkout, whose `.ai/cezar/cockpit.lock` the live cockpit owns. `.ai/qa/test-env-app.log` (local 20:28:34, matching the crash at 18:28:31) holds one line: `A cockpit already serves /home/agent/projects/cezar/.ai/cezar at http://0.0.0.0:4321`. `start_app` logs "the app exited during boot" and `exit 1` (`test-env-up.sh:516-518`). `write_descriptor` runs only after a healthy boot, so `.ai/qa/test-env.json` keeps its 2026-09-12 content: `status: running`, `baseUrl: http://127.0.0.1:43275`, `browser.installed: false`, `notes: "live browser launch failed after autonomous install"`. Worktrees escape this because each has its own `.ai/cezar/`.

The throw is a `globalSetup` throw, not a `setupFiles` entry or a `beforeAll` error. Each crashed run's log starts with `end: crashed (Error: Browser E2E environment bootstrap failed at Object.setup (packages/web/e2e/environment.ts:20:11) at TestProject._initializeGlobalSetup (…vitest@4.1.10…/cli-api.BK8pd4xc.js:10746:21)`. The 74 stored errors come from the files' own file-level `beforeAll` (`AgentBrowser.open`, `agent-browser.ts:414`, or a `fetch` of the dead `baseUrl`). They read the descriptor the failed setup never rewrote.

**Why the tests ran anyway.** Vitest 4.1.10, `TestProject._initializeGlobalSetup` (`cli-api.BK8pd4xc.js:10743`), identical in 5.0.3 (`index.DpLw24bj.js:12180`):

```js
if (this._globalSetups) return;
this._globalSetups = await loadGlobalSetupFiles(this.runner, this.config.globalSetup);
for (const globalSetupFile of this._globalSetups) { const teardown = await globalSetupFile.setup?.(this); … }
```

The field is set before any `setup()` runs. A throw leaves it set, and the next `runTestSpecifications` on the same instance returns at the first line. `workspace-registry.ts`, the second entry, never runs either. Squeal's daemon keeps one instance across runs (D4) and replaces it only on a touch, a trigger file, an install, a hang, or a module-loading runner failure (`adapter.ts` `#instance`, `#invalidate`, and `broken.ts` `runnerFailure`). A rejected run matches none of these: `execute` maps the rejection to `end: "crashed"` (`run.ts:47-52`), and `run()` keeps the instance. The timeline of the checkpoint at revision 3 shows it:

| UTC | Run | File | End |
| --- | --- | --- | --- |
| 18:11:17 | 40416841 | settings-sidebar | crashed: bootstrap failed (3.6 s) |
| 18:11:23 onward | 73 runs | every other browser file | completed: file FAIL, tests SKIP (about 2 s each) |
| 18:28:31 | 36ff5e2d | agent-browser-tabs | crashed: bootstrap failed (a fresh instance, after the packaged tier ran) |

The checkpoints at 15:58 (revision 0) and 16:58 (revision 3) show the same pair of crashes and 76 or 73 completed runs.

## (b) What 0.1.168 stored and showed

Store copy taken at 18:29, worktree `b7555ac0d0f19f40` (main, `daemon_version` 0.1.168):

- `known_states`, project `e2e`: 74 `file` checks `fail`/`current` (54 provider message, 20 `fetch failed`) and 680 `test` checks `skip`/`current`. `agent-browser-tabs.e2e.ts` has no state. Other projects: 2 `server` and 2 `web` test failures.
- `runs`: 6 browser runs `crashed`, all with the bootstrap error. 222 `completed`.
- The status the cezar session read at 18:16 (its transcript): `Known failures: 79 (5 tests, 74 test files that did not load)`. Each row read like `FAIL [e2e] packages/web/e2e/agents-dock.e2e.ts (file-level) cezar e2e: the agent-browser provider is not installed (…) at packages/web/e2e/agent-browser.ts:414:13, observed at revision 3, current`. Nothing in that output names the `globalSetup` failure. The crash is only in the run log, and without its cause. The session said so itself: "Squeal's run log doesn't show the setup output".
- The 74 rows stay current while their keys hold (001-310). A cezar fix outside the declared inputs does not clear them. Only `run --all --force`, or `squeal retry` (001-368, planned), clears them.

## (c) 0.1.174

`git diff e751a536 HEAD` (0.1.168 to 0.1.174) under `src/runners/vitest/` touches only `reporter.ts` and `results.ts`, plus `src/core/scheduler/records.ts`. That is 001-360 (describe-level hook errors) and 001-361 (`code`, `cause`, `phase`). The run-crash path and the instance lifetime did not change. With 0.1.174 the same 74 rows read `setup failed: cezar e2e: the agent-browser provider is not installed …`, because `recordsForFile` tags a file-level error with tests reported as phase `setup`. `fetch failed` gains its cause code where undici supplies one. The count is unchanged. The run-level `failure` is still `error.stack`, so "Browser E2E environment bootstrap failed" is stored without the `cause` that names the cockpit refusal.

The fixture reproduces this under the 0.1.174 bundle (experiment 3 below).

## Experiments (fixture, Vitest 5.0.3)

`/tmp/r375-fixture`: projects `unit` (one passing test) and `e2e` (three files, each with a file-level `beforeAll` that throws "the provider is not installed" when the committed stale `state.json` says `installed: false`). The `e2e` project's `globalSetup` logs each call to `setup-calls.log` and throws "Browser E2E environment bootstrap failed" with a `cause`. It is cezar's shape.

1. **Vitest CLI** (`npx vitest run --maxWorkers=2`): one "Unhandled Error … Browser E2E environment bootstrap failed … Caused by: Error: A cockpit already serves this checkout … Serialized Error: { code: 'E_OWNED' }". No test file ran, not even the `unit` project's. Exit 1. Setup was called once. *Verified by experiment.*
2. **One instance, three runs** (`reuse.mjs`: `createVitest`, `standalone()`, then `runTestSpecifications` per file, as Squeal's daemon does): `a` rejected with the bootstrap error and its cause. `b` and `c` **completed**, each with module error "the provider is not installed (stale descriptor)" and tests `skipped,skipped`. `setup-calls.log` has **1 line**. *Verified by experiment.* It reproduces cezar's logs exactly.
3. **Squeal 0.1.174 bundle** (`plugins/claude-code/dist/cli/squeal.mjs`, cezar's `slow` shape of `maxWorkers: 1, maxParallel: 1`, `HOME` pointed at the fixture, `squeal run --slow --wait`). The slow tier waited 284 s for the host load to drop. Then:
   - Run 3f5c40d1, `a`: `end: crashed (Error: Browser E2E environment bootstrap failed at Object.setup (setup.ts:9:11) at TestProject._initializeGlobalSetup …)`. The log has no line naming the cause (`A cockpit…`, `E_OWNED`, `Caused` match 0 times).
   - Runs 35c4a5fa and d9308ef0, `b` and `c`: `end: completed`, `MODULE failed`, tests `SKIP`.
   - `setup-calls.log` has **1 line**.
   - Status: `Known failures: 2 (2 test files that did not load)`, each row reading `setup failed: fixture e2e: the provider is not installed (stale descriptor) … current`, plus `Test files without checks: … 1 unknown`.

   So 0.1.174 gives cezar's 0.1.168 result with 001-361's new wording, and the count still says "did not load". *Verified by experiment.*

## (d) What Squeal should do

What Vitest does: a `globalSetup` throw is a startup error. No test of any project runs, one error is printed with its `Caused by:` chain, and the exit code is 1 (experiment 1). Vitest never reports N file failures for it. That only happens on an instance that has already swallowed the failure (experiment 2), and that state is reachable only through the API or a rerun, never through `vitest run`.

The options against that:

- **Nothing.** This keeps a fidelity bug. Squeal runs tests in an environment Vitest would refuse to run them in, then stores the results as current FAILs (or, for a setup that only seeds data, as current PASSes). Spec 001 D4 already treats global setup as part of what an instance "read once" (task 001-157). D5 says "a runner call that fails is a state, never a skip". The cezar case is the result: 74 counted failures, none of them a test's, and the one real cause shown nowhere. *Inferred.*
- **Skip and say so** (Squeal stops running the project's files and reports why). This is right in effect, but it is the same as the next option once the instance is fixed.
- **One setup failure instead of N.** Recommended. When a run rejects in global setup, close the instance (as `closeBroken` does for D5's runner failure), so the next call starts a new one and runs the setup again. Then block the run's projects through D5's existing path (`failures.ts` `block`): every file of the project is `unknown`, the reason is "global setup failed: <message>: <cause chain>", one line is delivered, a note is persisted, and nothing is stored under a key. The retry comes at the next revision or `run --all` (`Ledger.broken`). A `run --all --wait` then ends with no verdict (exit 3), which is the truth. Without the block, recreating alone would re-run cezar's bootstrap (up to 300 s) once per file, 75 times. *Inferred from D5, D12 and experiments 1 and 2.*

Unlike 001-348, no classifier is involved. "The setup threw before any test ran" is a fact Vitest establishes, and both Vitest and Jest ("Test suite failed to run") report it as one error. A product bug that stops the server booting still shows: it is the delivered line and the note, and the files stay unknown and unrun. They are not passed. Whether that one setup failure should also count in "Known failures" is the human's call, because the store has no project-level check today.

Detection without private API: the rejection's stack names `_initializeGlobalSetup`, and the run collector has no module started. The cleaner signal is to call setup separately, but `Vitest.initializeGlobalSetup` and `TestProject._globalSetups` are private in the 5.0.3 typings (`plugin.d.BsjqSb4-.d.ts:1039, 2539`). Closing the instance after *any* rejected `runTestSpecifications` is the simplest rule that needs no detection at all. Crashes are rare, and an instance after a rejection is in a state Squeal does not know. Separately, `describeError` (`run.ts:227`) should keep the `cause` chain 001-361 added for check errors, so the reason names the cockpit refusal.

## (e) Cezar's part

1. **The main-checkout boot.** `test-env-up.sh` starts the test server with `--repo` set to the real checkout, so it collides with the live cockpit's lock. Boot against a scratch data directory or an isolated clone. The daff3d7f session is doing this (18:26: "an isolated clone of the checkout at about 2 s and 800 MB").
2. **The stale descriptor.** A failed boot leaves the September `test-env.json` saying `status: running`. Remove or invalidate it before booting.
3. **The specs trust any descriptor.** `readTestEnv()` should refuse one this run's setup did not write (compare `startedAt`, or check `app.pid` is alive). That way a skipped or failed setup gives the real error in any runner, Vitest's watch mode included.
4. After cezar is fixed, the 74 current rows need `run --all --force` or, once it lands, `squeal retry --reason environment`. Their keys do not change.

Squeal's part is the instance fix in (d), the cause chain on a run crash, and 001-373's count wording.

## Open questions

1. Whether Vitest's own watch mode reruns after a failed global setup the same way (same field, so probably yes). Not probed. If it does, it is an upstream Vitest bug worth reporting: `_globalSetups` is assigned before the setups succeed.
2. Why the second crash of each checkpoint landed on a fresh instance (18:28:31, after the `test:package` and `server` runs). It is consistent with a recreate after a touch (D4, 001-159). Not traced further, because the logs do not record recreates.
3. Whether a `globalSetup` failure should count once in "Known failures" or only show as `unknown` with a note. This is the human's decision.

## Sources

- Cezar (read-only, `d3ad245d`): `vitest.config.ts`, `squeal.config.json`, `packages/web/e2e/{vitest.config.ts,environment.ts,agent-browser.ts:395-416}`, `.ai/scripts/test-env-up.sh`, `git show d3ad245d` (#1019) and `20880223` (#1017), `.ai/qa/{test-env.json,test-env-app.log}`, `.ai/cezar/runs/daff3d7f-….{handoff.md,ndjson}`. The Squeal store `.git/squeal/store.sqlite` (copied) and `.git/squeal/runs/{40416841…,342a29d1…,36ff5e2d…}/{vitest.log,report.json}`.
- Vitest 4.1.10 (cezar's `node_modules/.pnpm/vitest@4.1.10_…/dist/chunks/cli-api.BK8pd4xc.js:10743-10760, 13575-13620, 13741-13746`). Vitest 5.0.3 (`index.DpLw24bj.js:12180-12188, 21282`, `plugin.d.BsjqSb4-.d.ts:1039, 2539`).
- Squeal `83e2d4e8`: `src/runners/vitest/{adapter.ts,run.ts,broken.ts,project.ts}`, `src/core/scheduler/{failures.ts,tiers.ts,records.ts}`, `src/core/status/checks.ts:60`. Spec 001 D4 (task 001-157), D5, D12. `research/environment-failures.md`. Board rows 001-310, 001-348, 001-360, 001-361, 001-368, 001-373.
