# 011-78: a configuration reload reconciles the node:test and pytest projects

Worker notes for row 011-78, brief W1 of `tasks/wave-17.md`: R1 of `tasks/011-62/design.md` section 4.2, under 011 C10, *Projects at a reload*. From main at 0.1.269.

## What changed

| File | Change |
| --- | --- |
| `src/core/daemon/runner-set.ts` (new) | `createRunnerSet(entries, build)`: one runner per live entry, keyed by name, each with a stamp of its entry (canonical JSON, object keys sorted). `reconcile()` returns the removed runners, the replaced runners and the sorted names of every project removed, added or replaced. A rename is a removal and an addition. |
| `src/core/daemon/node-test-runners.ts`, `pytest-runners.ts` | `createNodeTestRunnerSet` and `createPytestRunnerSet` over a getter of the live entries. `createNodeTestRunners` and `createPytestRunners` stay, unchanged in behaviour, for the tests that build fixed runners. |
| `src/core/daemon/composite-runner.ts` | `createCompositeRunner(adapters, sets = [])`. The members are `adapters` and the sets' members, read again after each reconcile. `invalidate` reconciles first: it deletes the owner entries of every leaver, then fans out, then reports the sets' projects with the members' recreated ones. `name` and `adapterVersion` are getters. `run` groups its files in one synchronous pass once every owner is known. |
| `src/core/daemon/composite-flights.ts` (new) | `Flights`: the parts in flight per member. A removed member's parts get a stop signal joined to the run's `stop` (the node:test and pytest runs stop their processes on it, C9) and report their files as `withheld`, nothing else. A replaced member's part in flight finishes and reports. A leaver of either kind starts no part: its files are `withheld`. A leaver closes once its last part ends; `close()` waits for those closes. |
| `src/core/daemon/daemon.ts` | Wiring: the two sets over `() => this.#policy.nodeTest` and `() => this.#policy.pytest`. `#reloadPolicy` keeps `nodeTest` and `pytest` when the load reports `unparsed` (Q3). Which runners exist (Vitest or not) is still decided at start only. |
| `src/core/daemon/config-file.ts`, `policy.ts`, `src/core/types/policy.ts` | `LoadedConfig.unparsed?: true` and `LoadedPolicy.unparsed?: true`, additive: set when the file exists and cannot be read, is not JSON or is not an object. A missing file is not unparsed: it removes the projects, as written. |

## The path after the reconcile, all existing

The reload runs in the revision's content part (`#reloadPolicy`), the reconcile in that revision's runner part: `fetchRunnerPart` calls `runner.invalidate`, the composite reports the projects recreated, so the environments and the listing are read again (`refinement.ts`), and `applyRunnerPart` forgets the files the listing no longer has (`Ledger.removeFile`: key, queue, retry claim, checks, and a told failure delivered once as `fail-retired`). Nothing in `src/core/scheduler/` changed.

Why `withheld` for a removed part: a stopped part's files are not `completedFiles`, and the tier's `cancelled` is false (the tier's own signal was not aborted), so `storeDecision` would give `unknown` and write an `unknown` state over a told failure before the listing retires it. `withheld` gives `withheld` (the file queues again, counted as a discard) while the ledger still holds it, and `gone` once it does not. No tier is selected while a runner part is pending (C4), so the queued file never runs before the listing forgets it.

## Tests, against R1's list

| R1 test | Where |
| --- | --- |
| 1 removed | `test/daemon/reload-projects.test.ts` "forgets a removed project, tells its failure once as resolved and keeps the rest" |
| 2 added | same file, "lists an added project and runs its file once" |
| 3 changed | same file, "recreates a changed project: its env and include re-key it, its slow flag does not" |
| 4 renamed and swapped | same file, "runs a renamed project under its new name, and two swapped names without a conflict" |
| 5 in flight | `test/daemon/reload-projects-flight.test.ts`, the first two tests |
| 6 unparsable | `reload-projects.test.ts`, "keeps the projects through a file that does not parse, and reconciles at the next" |
| 7 retries | `reload-projects-flight.test.ts`, "releases a removed project's pending retry, and status lists none" |
| 8 probe | not run: the coordinator's, against the candidate's bundle (`tasks/011-62/probes/run.sh`) |
| 9 | `test/keys/key-format.test.ts` passes with no raise. Existing tests changed: `test/daemon/policy.test.ts`, two expectations gain `unparsed: true` and one asserts a parsed file has none. No `test/scheduler/` test changed. |

Unit tests of the seam: `test/daemon/composite-reconcile.test.ts` (fake members; the real node:test and pytest sets without an adapter).

The real-daemon tests start `startDaemon` in this process over a repository under `/tmp` where `vitest` does not resolve, so only the node:test runners exist (`test/daemon/reload-projects-kit.ts`). Each fixture test appends its name to a log outside the worktree; a held body sleeps while a hold file exists. Two details a later test must know: a new failure runs twice (001 D6 as amended, task 001-171), so a failing file's baseline count is 2; and `squeal status --wait` (`waitForStatus`) is how a test waits for a revision's runner part.

Test 5 checks that the tier ended less than 30 s after the config write, with a 60 s held file, and that the held test never logged its end. That bound holds the revision's latency under load as well as the stop and its 2 s grace; it proves a stop, not the grace itself.

`test/version-sensitive.txt` lists `test/daemon/reload-projects` (both files run a real `node --test`) and exempts `test/daemon/composite-reconcile.test.ts`, by the coordinator's approval of request d78b2202.

## Decisions the design did not settle

- **A leaver's part not started yet** is withheld, for a replaced member too: its old runner is closed, and its files run at their new key after the listing. The design names only the part in flight ("finishes").
- **A reorder of an entry's keys** is no change (sorted-key stamp). An `env` with the same pairs in another order recreates nothing.
- **A close failure of a leaver** is dropped: the node:test and pytest adapters' `close` does nothing, and the recovering wrapper only marks itself closed.
- **Reconcile at every `invalidate`**, not only when `squeal.config.json` is among the paths: the stamps are cheap, as the Vitest adapter's exclusion stamp is read at each `invalidate`.

## For the next worker

- R1 is done but for test 8, the probe against the candidate's bundle.
- No pytest project ran through a daemon here. The pytest set is the same `createRunnerSet` and its unit test covers the wiring (`backlogSlot` follows a changed `batchSize`).
