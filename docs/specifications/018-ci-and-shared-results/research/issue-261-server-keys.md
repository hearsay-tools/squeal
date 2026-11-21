# Research: why squawk's `server` test files miss CI's keys (018-72, gh-261)

Researcher task 5415a5bd, 2026-11-21. Brief: `tasks/wave-23.md`, 018-72. Squeal source at `bf23dbc07` (0.1.585). Reporting project: hearsay-tools/squawk, read only: its store `~/projects/cezar/.git/squeal/store.sqlite` (node:sqlite `readOnly`, `PRAGMA query_only`, never copied, no daemon touched), `git ls-tree` in its clone, and two exports fetched into a scratch repository (`refs/squeal/444e9ae4…`, Squeal 0.1.522; `refs/squeal/9682a717…`, Squeal 0.1.582). No daemon started, no boat.dev sandbox (no timing question). Probes: `probes/issue-261-server-keys/` (throwaway). Tags: **[exp]** verified by experiment, **[src]** read in source code, **[docs]** read in spec, **[inf]** inferred.

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | Which runs make up the 14,600 file-seconds? | The parent's rule (`ffload-commits.cjs`, rule A) reproduces 12,828 s for `server`. 12,816 s of it (99.9%) came from exports CI made with Squeal 0.1.522, which it ran until 2026-11-21 about 03:40Z. Since CI runs 0.1.582: 12 s of `server` (20 s in all projects), against 6,518 s that matched. | exp |
| 2 | Which key part differs today? | At one clean commit (`9682a717`, two live worktrees), 1,911 of 1,946 exported files have the same key. The 35 that never match are a **closure** difference, in two causes: (a) 29 `ui-mapper-robustness*` files: CI's closure holds 31 module paths the local closure lacks (CI keys loaded modules, a coverage-off daemon does not); (b) 6 files whose closure holds `.git`: D11's proof and re-key key `.git` from the commit tree, the daemon keys it by its kind. No environment part differs beyond D10's tolerated fields. | exp, src |
| 3 | What differed in the 0.1.522 period? | 4,944 s: the file was not in the export (467 of those 543 files are in the 0.1.582 export). 1,536 s: in the export, not re-keyed, so CI's key was kept. 6,336 s: re-keyed, but the worktree's key had moved since. Which input moved is not determined per file: the store keeps no history of a worktree's environment hash or closure lists. | exp; not determined |
| 4 | Why mostly `server`? | `server`'s environment hashes `vitest.setup.ts` and its 16 imported files, among them product modules (`runners/ids.ts`, `runs/run-exits.ts`, at times `core/agent-runner.ts`). It took 47 local environment hashes in the week; `web` 8, `contract` 5. Each one re-keys all `server` files at once. `server` also holds 1,378 of the 1,946 exported files. | exp |
| 5 | Smallest change that makes keys match without a false pass | (b): key `.git` by kind in D11's proof and re-key (Squeal). (a): record each file's loaded modules with coverage off too (Squeal, spec 022 D1), or replace the computed import in squawk's `ui-mapper-robustness.testkit.ts` with static imports (squawk). Not: drop loaded modules from CI's key. | src, exp, inf |

## Findings

### Q1. The 12,828 s, split by cause

**[exp]** `week.cjs` is the parent's script with the same run rule and match rule (a run key equal to a key in any import), plus a class for each unmatched file-run on a commit whose export was imported (`out-week.json`, window 2026-11-14T11:27Z to 2026-11-21T11:27Z):

| `server` file-seconds | CI Squeal 0.1.522 | CI Squeal 0.1.582 |
|---|---|---|
| matched an import | 8,909 (both) | |
| file absent from the commit's export | 4,944 | 2 |
| in the export, import kept CI's key (not re-keyed) | 1,536 | 0 |
| re-keyed, the run's key differs | 6,336 | 10 |
| **no match, total** | **12,816** | **12** |

Before 0.1.582 an export held about 1,229 files; from 0.1.582 about 1,941 (`issue-261-ci-import.md` Q3). Of the 543 files absent from the 0.1.522 exports, 467 (5,380 s) are in the 0.1.582 export of `9682a717`; 76 (913 s) are not, for example `lint/lint-runner.test.ts` and several `*-parity.test.ts` files (not checked why). The rest of the parent's 27,513 s is commits with no import (13,389 s).

### Q2. Today: two closure causes, proven

**Same commit, Squeal's own D5 rule [exp]** (`d5.ts` calls `readImports` and the same per-file rule on the store; `out-d5-9682.jsonl`). Worktrees `190ef455` and `25fc5639`, both clean at `9682a717`, against its import `97779275`: 1,911 same key, 30 "environment differs", 5 "content differs", 0 closure, 0 observed. `environmentDifferences` is empty: CI's `server` descriptor and the local one differ only in `config.allowOnly`, `config.watch`, `config.browser` and `ci` (`out-env-ci-vs-local.txt`), all tolerated by D10. "Environment differs" here means the import did not re-key the file and kept CI's environment hash.

**(a) Loaded modules [exp, src].** The 29 per-runner and core `ui-mapper-robustness*.test.ts` files. `core/ui-mapper-robustness.testkit.ts:32` loads each runner's mapper with `import(/* @vite-ignore */ \`../runners/${runner}/ui-mapper-row.testkit.ts\`)`, so no static graph holds those modules. For `claude/ui-mapper-robustness.test.ts`, CI's closure has 51 paths, the store's list plus `observed` has 20; the 31 extra are the runner mappers and what they import (`rekey-check.ts`, `out-rekey-check-9682.jsonl`). Each worktree's own key equals `keyOver(local environment, stored list + observed, commit blobs)` for all 29, so the local key does not hold the 31 paths. The export proves its key (1,377 of 1,378 `server` files proven). `rekeyFiles` then refuses: the local list does not hold every exported path (`holdsEvery`, `transfer-rekey.ts`), and the import stores the result at CI's key, which no local key equals.

Why the lists differ [src]: spec 022 D2 joins each file's loaded-module list to its observed paths. In CI, `ci record` always adds Squeal's coverage provider (D8, 020 D13), which returns the list. In the daemon, the Vitest adapter adds the lists only when its instance runs coverage (`adapter.ts:779`, `uncovered !== null`); squawk sets `coverage.enabled: false`. The store's `observedModules.server` entry for the file does hold the 33 module paths (probably added by an import, D3 step 4, since this daemon makes no list with coverage off **[inf]**), but `observedModules` enters no key (`keying.ts:521`). For the 28 per-runner files, stored list + `observed` + `observedModules` equals CI's list exactly (`modules-equal.mjs`, 28 of 28); the core file differs by older entries.

**(b) `.git` [exp, src].** 6 files hold `.git` in their closure: `core/product-env-cli`, `home/runtime-cli`, `server-install/cli`, `server/automations-api`, `server/preview-socket`, `server/task-webhook-api`. The daemon keys `.git` by its kind (`gitEntryByKind`, `keys/observed.ts:69`): in squawk's linked worktrees it is a file. `commitSegments` (D11 proof and re-key) reads `.git` from the commit's blobs, where it is absent. In both worktrees all 6 own keys reproduce with `.git` keyed as a file and none with the commit tree (`git-entry.ts`, `out-git-entry-9682.jsonl`). So five re-keyed files land at a key that has `.git` as absent ("content differs"). For `runtime-cli`, CI's closure holds `.git` too, keyed as CI's directory, so the export's key is not proven and the import keeps CI's key.

Cost in the week [exp] (`cost.mjs`, distinct keys a local worktree stored, check time): the 6 `.git` files ran 1,445 times, 6,369 s; the 29 robustness files ran 86 times, 318 s. Few of those runs were pull reruns (`runtime-cli` 14 s in the 0.1.522 period).

### Q3. The 0.1.522 period: keys moved after the import

**[exp]** The largest event: worktree `cc3559cf` moved to `444e9ae4` at 15:03Z on 2026-11-20 and ran 3,591 s of `server` files that matched no import. Three imports of that commit exist: 14:53 (`7aab4b7a`, kept CI's environment), 14:55 (`97caedf2`, re-keyed to local environment `fe542a26`), 23:25 (`6b6e71b5`, re-keyed to `78ec240e`). Local keys moved inside the one clean commit: 197 of 830 `server` files have 2 or 3 local keys at `444e9ae4` (`out-same-commit-444e.json`), recorded in 23 ten-minute groups from 15:00Z to 23:30Z (`out-key-times-444e.txt`). `fe542a26` and `78ec240e` differ only in `config.coverage`; `78ec240e` and `de4dd77e` only in the blob of `runners/ids.ts`.

**Not determined [exp]**: which input moved each run's key. `decompose.ts` tried every environment hash the store ever recorded for `server` (local and CI) with three closure lists (the export's, the store's list + `observed` now, and that + `observedModules`): none reproduces any of 515 sampled run keys (`out-decompose-444e.json`), although the export's own key reproduces for all 1,215 files. The closure list each run used is gone: `test_files` and the observed sets are store-wide and hold only today's state, and nothing records a worktree's past environment hash (`worktree_environment_hashes` holds the latest; run reports and daemon logs hold none). `keyParts` are empty in both exports, so they are not the cause.

**[inf]** What the data allows: one import re-keys once, to the importing worktree's environment and closure lists of that moment. A later move of either (a new `server` environment, a closure list another worktree grew) leaves the import at keys no worktree computes. With 0.1.582 exports the same mechanism is the 018-70 race (an import before the revision stores its closure lists), and the measured residue is 10 s.

### Q4. Why `server`

**[exp]** (`env-diff.mjs`, `out-env-server-week.txt`): 47 local `server` environment hashes in the week, against 8 for `web` and 5 for `contract`. Of the changes between them, 43 changed a file in `vitest.setup.ts`'s closure (most often `core/agent-runner.ts`, `runs/run-exits.ts`, `vitest.setup.ts`, `runners/ids.ts`), 13 the installed dependencies, 1 `config.coverage`; one change can hold more than one. At `9682a717`, CI's `server` descriptor lists 17 environment files, 6 of them under `packages/*/src/` (`runners/ids.ts`, `runs/run-exits.ts`, three testkits, `contract/src/usage-limit-hold.ts`); `web` lists 12, one under `src/`. **[src]** An environment hash enters every key of the project (D1), so each change re-keys all `server` files in each worktree that sees it. This is why pull reruns are mostly `server`; it is not a CI mismatch at an equal commit.

## Recommendation

The `server` waste the parent measured is almost all history: CI's 0.1.522 exports lacked about 470 files and older imports were stranded by later key moves. With CI on 0.1.582 it is 12 s, and the 018-70 reader fixes target what remains. Two closure gaps still make 35 files (1.8%) never current from CI:

1. **Squeal, `.git` in D11 (6 files here).** In `rekeyFiles`, key `.git` by this worktree's kind (`gitEntryHash(root)`), as its daemon does. In `proven`, accept the export's key when it reproduces with `.git` as a file, a directory or absent. No false pass: the kind is what the local key already holds, and content segments are unchanged. Affects every project with linked worktrees whose tests read `.git`.
2. **The robustness files (29 here).** Smallest safe change on the Squeal side: record each file's loaded-module list with coverage off too (spec 022 D1 reads `__vitest_worker__.evaluatedModules`; today only the coverage provider reads it), so local keys hold what CI's hold. This also closes a local gap: today a squawk worktree's key for `claude/ui-mapper-robustness.test.ts` does not hold `claude-ui-mapper.ts`, so an edit to that mapper leaves the file's pass current **[inf, from the recomputed key]**. Cost not measured. Smallest squawk change: static imports of the runners' `ui-mapper-row.testkit.ts` in `core/ui-mapper-robustness.testkit.ts` (needs squawk's human). Rejected: dropping loaded modules from CI's key. Keys would match because both would lack the 31 inputs, a false pass on both sides.

## Open questions

1. Should the daemon collect loaded-module lists without coverage (option 2)? It needs a worker hook beside the coverage provider; its CPU cost is not measured (the provider with V8 coverage cost +22% on short files, 020 D13.7).
2. Should `server`'s 47 environments a week be reduced? A setup file that imports product modules puts them in every `server` key. That is squawk's design, and correct; Squeal could only report it.
3. Why are 76 files (913 s) absent from the 0.1.582 export too? Needs `ci export`'s left-out lines in a squawk run log.

## Sources

- Parent's script and output: `~/projects/squeal/.ai/squawk/t/27f5bf0c/ffload/ffload-commits.cjs`, `out-7d-commits.json` (read only; rule copied into `week.cjs`).
- Spec 018 D1, D3, D5, D10, D11, D14; spec 022 D1, D2; 020 D13; `research/issue-261-ci-import.md`.
- Source at `bf23dbc07`: `src/core/store/transfer-rekey.ts` (`rekeyFiles`, `proven`, `holdsEvery`, `commitSegments`), `src/core/status/imports.ts` (`readImports`, `reasonOf`), `src/core/keys/observed.ts` (`gitEntryByKind`), `src/core/ci/inputs.ts` (`gitEntryHash`), `src/core/scheduler/keying.ts` (`setClosure`, `markModules`), `src/core/scheduler/observed.ts`, `src/core/ci/loaded-inputs.ts` (`withLoaded`), `src/runners/vitest/adapter.ts` (`#withLoaded`), `src/runners/vitest/ci-runs.ts` (`loadedOf`).
- Squawk, read only: `squeal.config.json` (coverage off, `shared.ref`), `packages/cezar/vitest.config.ts`, `packages/cezar/src/core/ui-mapper-robustness.testkit.ts` at `9682a717`, the store (imports, `import_files`, `environments`, `worktree_environment_hashes`, `test_files`, `test_file_keys`, `meta` observed maps, `results`, `runs`, run reports), `git ls-tree` of `444e9ae4` and `9682a717`, `refs/squeal/444e9ae4…` and `refs/squeal/9682a717…` from https://github.com/hearsay-tools/squawk.
- Probes and outputs: `probes/issue-261-server-keys/` (`README.md` lists each script and what it touched).
