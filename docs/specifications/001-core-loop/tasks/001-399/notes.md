# 001-399 notes: the bundle tests' and daemon-from-source tests' inputs

## OpenCode and Pi: applied

`squeal.config.json` now gives `test/harness/opencode/**/*.test.ts` the inputs `plugins/opencode/**` and `src/**/*.ts`, and `test/harness/pi/**/*.test.ts` the inputs `plugins/pi/**` and `src/**/*.ts`. This matches what `test/harness/codex/**` and `test/harness/plugin.test.ts` already declare. These tests build their bundles from `src/harness/*/entries` in an esbuild child process and read the committed package. Static tracing follows neither (spec 001, the closure is incomplete by construction).

**A second defect, found while testing the first.** The root `.gitignore` ignores `dist/`. `plugins/claude-code/.gitignore` and `plugins/codex/.gitignore` re-include it (`!dist/`), but `plugins/opencode/` and `plugins/pi/` had no such file. Their committed bundles were therefore gitignored paths, and D2 drops gitignored paths at watch time. `plugins/opencode/**` would never have seen a rebuild, and a rebuild is the edit that clears a drift FAIL: wave 7 input 4's shape. With the coordinator's agreement (008 and 009 own the packages), `plugins/opencode/.gitignore` and `plugins/pi/.gitignore` are now the same two lines as Codex's. They only un-ignore, and the dist files were already tracked. `npm pack --dry-run` lists the same files before and after: OpenCode 24, Pi 19, `diff` empty.

### Tests

`test/policy/repository-inputs.test.ts` gains three cases on its mirror of the repository:

- A change to `plugins/opencode/dist/plugin.mjs` re-keys exactly the 16 `test/harness/opencode/` test files. A change to `plugins/pi/dist/extension.mjs` re-keys exactly the 11 `test/harness/pi/` ones. Both were red with the inputs alone (`expected [] to deeply equal [ …(16) ]`) and turned green with the two `.gitignore` files.
- An edit to `src/harness/opencode/bridge-turn.ts`, a file outside the package test's traced closure, re-keys both package tests.

### Probe under Squeal (this worktree's daemon, Squeal 0.1.168)

1. **Before.** HEAD was at 001-396's commits, whose `src/core/delivery` change is in every bundle. `squeal status --wait … test/harness/opencode/package.test.ts test/harness/pi/package.test.ts` said "no known failures; 2 test files, each with a current result", from results inherited at the old keys. `npx vitest run` on the same two files failed "hooks/after.mjs differs from the build" and "worker.mjs differs from the build".
2. **After the policy commit**, revision 28. Squeal re-keyed both files and reported PASS -> FAIL for each with the same drift message.
3. **The brief's probe**, revision 29. One legal comment (`/*! … */`, which esbuild keeps) was appended to `src/harness/opencode/bridge-turn.ts`, with no rebuild. That file is not in `package.test.ts`'s traced closure, which holds `src/harness/opencode/build.ts` and `entries/hooks/` only. Squeal re-ran the package test under a new key (`29fb3eece2a7`): FAIL, observed at revision 29, "hooks/after.mjs differs from the build". The edit was reverted afterwards.

`squeal why` on that check also shows "Flaky: FAIL -> PASS under the same inputs (key aed18127787a, 2026-10-14)": a PASS and a FAIL recorded under one key, the trace this defect leaves in a shared store. Older keys of that kind age out, but a worktree whose `src` matches one can still inherit its PASS until then.

## test/daemon/ and test/scheduler/: measured, not applied

**Which files.** `test/scheduler/` starts its daemons in process: no file there spawns a daemon from the sources. In `test/daemon/`, 28 files start a real daemon from the sources in a child process:

- `busy-store.test.ts` and `shared-store.test.ts`, through `node --import tsx` (`long-writer.ts`, `pruning-daemon.ts`);
- the other 26, through `daemonSuite` or `suiteCli`, which compile all of `src` with `tsc` in `beforeAll` and spawn `dist/cli/index.js`.

`suite-hooks.test.ts` (001-385) stubs the build and is not counted.

**Method.** Data comes from this worktree's store (read-only), taken 2026-10-15 at load 50 to 75 on 24 cores. Each file's cost is the median, over its last 7 passing runs, of the summed check durations. That sum leaves out the `tsc` build (2.1 s wall at load 72, timed here) and the worker start. A file newly re-runs on a `src` edit only when the edited file is outside its traced closure, so the expected count per edit is the sum over files of (1 − closure ∩ src / src). There are 475 `src` `.ts` files.

| Option | Re-runs per triggering edit | Test time per triggering edit | Edits that trigger it |
| --- | --- | --- | --- |
| `src/**/*.ts` | 21.2 files expected, 28 at worst | 382 s expected, 516 s at worst, plus about 2 s `tsc` per file | every `src` edit: 841 commits since 2026-10-01 |
| The daemon's own sources: `src/core/daemon/**`, `src/core/daemon-loop/**`, `src/cli/{daemon,index,main}.ts` (38 files) | 21.2 files expected | 380 s expected | 151 of those 841 commits (18%) |
| Nothing (as now) | 0 | 0 | none. The independent `npx vitest run` gates (reviewer, landing, CI) still run them. |

The closures are uneven. `exit-mark` and `shared-store` already trace about 311 `src` files, and `drain`, `departure`, `step-down` and `died` about 163. The `scratch-*`, `escaped`, `slow-lane`, `bootstrapped`, `composite-runner` and `user-config-note` files trace 36 to 38, so most edits miss them. The heaviest are `lifecycle` (80 s), `drain` (72 s), `departure` (51 s) and `busy-store` (44 s).

**Recommendation: the middle row, when a daemon test is next seen holding a stale PASS.** Until then, nothing. `src/**/*.ts` would add about 6.5 minutes of loaded test time, plus 21 `tsc` builds, to every `src` edit in every worktree, on a host this project already keeps at load 50 to 100 (process.md, "Test runs on a shared host"). The behaviour these tests check beyond their static closures is the daemon's: its entry, lock, lifecycle and loop. So the daemon's own sources are the inputs that would catch the 002/003 coordinator's 2026-10-08 sighting, at about a fifth of the edits. The gates' independent `npx vitest run` already catches what Squeal keeps, one review later.

Proposed `squeal.config.json` entry, not applied:

```json
"test/daemon/*.test.ts": [
  "src/core/daemon/**",
  "src/core/daemon-loop/**",
  "src/cli/daemon.ts",
  "src/cli/index.ts",
  "src/cli/main.ts"
]
```

`test/daemon/*.test.ts` also selects the in-process daemon tests. They trace those sources statically, so the entry adds nothing for them. Narrowing it to the 28 file names would keep it exact, at the cost of a list to maintain.
