# 011-62: a configuration reload drops removed projects, a design for the human

Board row 011-62, a docs-only design draft (brief W7 of `tasks/wave-8.md`). The human approved the row on 2026-10-21 (triage round 9, group B, gh-53). Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 5 go into 011 C10 and C6, `status.md` gets a dated line, and the board numbers the code rows of section 6.

Sources: `research/issue-53.md` and its probe `research/probes/issue-53/` (0.1.229); 011 C4, C5, C6, C7, C9, C10 and `status.md`; 003 D1 and D7; `tasks/011-37/design.md` (the key format rules); the source at `bb96a609` (main, 0.1.238). The relevant source moved since 0.1.229 only in `retry.ts` (011-24's optional `--reason`), `ledger.ts` and the Vitest adapter (011-40's refactors), none of it on this path. One new probe, `probes/run.sh`, output `probes/run.log`: the committed 0.1.238 CLI bundle in a throwaway repository under `/tmp`, with a scratch `HOME` and `XDG_*` and an otherwise empty environment (`env -i`). The one-minute load was 5.58 on 24 CPUs at its start. No full suite, no build, no daemon in this worktree.

Brief defect: `src/core/state/state.ts`, one of the brief's read-only seams, does not exist. The coordinator's correction of 2026-10-21 named the research's seams instead: `src/core/scheduler/revision.ts`, `src/core/daemon/node-test-runners.ts`, `src/core/daemon/daemon.ts` and `src/cli/retry.ts`. This design reads those and the brief's seams that exist.

Evidence tags follow `docs/process.md`: `verified by experiment`, `read in official docs`, `read in source code`, `inferred`.

## Summary

- **Today, every field of a `nodeTest` or `pytest` entry is read at start only.** A reload replaces the policy object, but the runners were built from the start-time lists. The probe changed a project's `env`, widened its `include`, renamed a project, added one and removed one during a session. The daemon ignored all five until a restart. The `env` change is the worst case: `keep` kept its PASS under a configuration whose `env` makes it fail, and it failed at once after the restart. That is a wrong verdict, not only a stale list.
- **The fix already exists for Vitest.** A moved `vitest.excludeProjects` or `vitest.exclude` makes the Vitest adapter recreate its instance and report the projects as recreated. The runner part then reads the test file list again, and `applyListing` forgets every file the list no longer holds, as for a deleted test file (tasks 001-349, 004-81).
- **Recommendation: one rule for node:test and pytest projects, R1.** A reload reconciles the composite runner's members with the file. A removed project's runner is closed and its files are forgotten. An added project's runner is built and its files are new test files. A changed entry's runner is recreated. A rename is a removal and an addition. The scheduler code that forgets a file, retires its checks and drops its result exists and does not change.
- **History stays, marked, R2.** Stored results stay in the store until pruning, as a deleted file's do. `squeal failures` marks a failure whose test file this worktree no longer has.
- **No key moves its meaning, no format raise.** A reconciled daemon computes the keys a fresh daemon computes from the same file. Every changed file is outside the validity bundles of 011-37's alarm.
- **Four decisions for the human**, Q1 to Q4, each with a default (next section).

## Decisions for the human

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | What happens to a removed project's files, states and history? (the board's "live catalog reconciliation versus retaining results explicitly outside the active configuration") | (a) Forget them as a deleted test file is forgotten: keys, states, queue and retry claims go, a told failure is delivered once as resolved; stored results stay as history until pruning. (b) Keep the states, marked "outside the configuration": not counted, not run, shown apart. (c) Leave the daemon as it is and filter in status and retry only. | (a). It is the path a deleted file and a Vitest exclusion already take, and a restart takes today. (b) adds a validity or a state field that every reader must learn. (c) keeps running the project. Section 2. |
| Q2 | A removed project's run in flight at the reload. | (a) Stop it as `squeal stop` stops a node:test or pytest run (C9), and store nothing it reports. (b) Let it finish, and store nothing. | (a). Nothing it reports is kept in either option. A removed project may be the one that hangs, and (b) holds its lane for up to `runner.timeoutMs` (600 s by default). Section 2.4. |
| Q3 | A reload whose file cannot be read, is not JSON or is not an object. | (a) Keep the projects as they were and note the problem. (b) Apply the defaults, as for every other key: every node:test and pytest project is removed. | (a). An agent's partial save would otherwise retire every node:test check, deliver each told failure as resolved, and re-list everything at the next save. Other keys keep (b). Section 3.4. |
| Q4 | Does `squeal failures` mark history outside the active configuration? | (a) Yes: a failure whose test file its worktree has no key for is marked (a deleted file or a removed project). (b) No: C6 already says it lists stored failures, not current ones. | (a). The row's done-when asks that retained history be explicit. One point lookup per listed row (at most 20). Section 2.6, R2. |

## 1. What a reload is today (brief question 1)

The daemon reads `squeal.config.json` at start (`daemon.ts:251`). A revision that changes it calls `SchedulerOptions.reloadPolicy` in the revision's content part (`revision.ts:103`, `:127`). That calls `Daemon.#reloadPolicy` (`daemon.ts:336`), which loads the file again, replaces `this.#policy`, restarts the timers and notes `squeal.config.json changed; policy reloaded`. The scheduler replaces `context.policy` and applies `WorktreeKeys.setPolicy` (`keying.ts:281`). *Read in source code.*

So a key is live when its reader reads the current policy object at use, and start-only when a value was copied out of it at start:

| Key | Read | A change during a session | Tag |
| --- | --- | --- | --- |
| `inputs`, `env.allowlist` | `setPolicy` re-keys; node:test reads `inputs()` per run | re-keys what they touch (C10) | read in source code |
| `observe.runtimeInputs` | `setPolicy`; Vitest's `observe()` | re-assembles every closure, recreates the Vitest instance (C10) | read in source code |
| `runner.*` | `context.policy` per tier; node:test and pytest `tierSize()` per run | next tier | read in source code |
| `slow.*` | `slowView(policy)`, compiled once per policy object (`slow.ts:15`); `slowWorkers()` per slow pass | next tier | read in source code |
| `vitest.excludeProjects`, `vitest.exclude` | the Vitest adapter's getters, compared with the instance's stamp at each `invalidate` (`adapter.ts:351`) | recreate, relist, forget the excluded files | read in source code; adapter test `test/runners/vitest/exclude-projects.test.ts` ("takes an edit of the key mid-session") |
| `daemon.*`, `store.*` | the timers, restarted by `#reloadPolicy` | next timer | read in source code |
| `baseline.onStart` | `bootstrap.ts:187` | the next start or install baseline | read in source code |
| `interrupt.*`, `stop.*`, `testCommand.*`, `delivery.*` | each hook call reads the file (`readPolicy`) | the next hook call | read in source code |
| `nodeTest`, `pytest` (every field of every entry) | copied at start (`daemon.ts:430`, `:431`), each entry captured in its runner's `create` (`node-test-runners.ts:138`, `pytest-runners.ts`) | none until a restart | verified by experiment (probe C1 to C4); research F2 |
| which runners exist (Vitest detected, or no other runner configured) | `daemon.ts:444` at start | none until a restart | read in source code |
| `capacity.*` (user file) | at start (C10 Configuration) | daemons started after | read in official docs (C10) |

Two side effects of the start-only lists, *read in source code*. Status reads the current file: `runnerLaneOf` (`standing.ts:304`) puts a removed node:test project's running file in the Vitest lane. The heartbeat's watch of the node:test observed-path rows follows the reloaded list (`lifecycle.ts:296`), while the runners do not. `env.remove` and `env.keep` (C10 Inherited environment) are not in the loader at 0.1.238: row 001-391 is planned.

**Probe, verified by experiment** (`probes/run.log`, 0.1.238). Projects `keep` (`env` `PROBE_MODE` `a`, its test asserts `a`), `gone` (fails) and `slow` (8 s).

| Step | Change, committed | What the running daemon did |
| --- | --- | --- |
| C1 | `keep`'s `env` to `b`, `include` widened to `more/*.test.mjs` | "re-keyed no test file"; `keep` still PASS; `more.test.mjs` not listed; 3 test files |
| C2 | `gone` renamed `gone2` | still `[gone]`; `retry gone/gone.test.mjs` queued, ran and "failed again" |
| C3 | project `added` | not listed; 3 test files |
| C4 | `slow` removed while its 8 s run was in flight | the run finished and its result was stored, current |
| restart on C4 | `stop`, `start`, `run --all --wait` | 4 test files run: `keep` FAIL (`env` `b`), `more` and `added` pass, `[gone2]` FAIL under a new check id; `slow` forgotten, `retry slow/slow.test.mjs` refused |
| C5 | the file made invalid JSON, daemon running | "Config problem: ... not valid JSON; the defaults apply"; projects unchanged |
| restart on C5 | `stop`, `start` | no `nodeTest`, so Vitest is built; it cannot start (not installed), so the listing fails and the 4 files stay listed as `unknown` |

**Recommendation.** C10 states which keys a reload applies, and the project lists join them (section 5). The choice of runners stays a start-time decision, named as such.

## 2. A removed project (brief question 2)

### 2.1 The mechanism the rule reuses

A test file the runner's listing no longer holds is forgotten by `Ledger.removeFile` (`ledger.ts:187`): its key leaves the key index, the queue drops it, a retry claim is released (`dropRetry`), its checks are retired, and its checkpoint entry is done. The ledger's commit removes its `test_file_keys` row (`ledger.ts:555`) and calls `sink.retire` (`:576`), which deletes the known states and the consumer views of every check not told as `fail`. A told `fail` stays in the view, so delivery reports it once: `FAIL -> no longer reported by the runner` (C5). The same path runs at a start (`bootstrap.ts:139`) and after a Vitest exclusion. *Read in source code.*

What is missing for node:test and pytest is only the trigger: the composite runner (`composite-runner.ts:28`) holds a fixed list of members, so its `testFiles()` keeps listing the removed project.

### 2.2 Today and after the reload

| Item | Today, until a restart | After the reload, under Q1 (a) |
| --- | --- | --- |
| Known states | current; counted in `Known failures` | retired in the runner part's commit; not counted |
| `test_file_keys` row | kept, re-keyed on each edit | removed |
| Queued work | an edit queues and runs it | dropped from the queue; an edit of its files is no keyed path, so nothing queues |
| Run in flight | finishes, result stored (probe C4) | Q2 (a): stopped; nothing stored (`storeDecision` gives `gone` for a file the ledger no longer holds, `store-decision.ts:147`) |
| Pending retry | accepted, claimed, run (probe C2) | claim released; status lists no pending retry, since it lists only requests at a keyed file's current key (`retry/pending.ts:28`) |
| New `squeal retry` | accepted | refused: "not a test file Squeal has keyed in this worktree" (`retry.ts:273`) |
| Delivery | the failure stays known | a told failure is delivered once as resolved; an untold one goes silently |
| Status, `run --all --wait` | counts it; exit 1 on it | not counted, not listed, not a file of the checkpoint |
| Stored results | kept | kept as history (2.6) |
| `squeal failures` | lists them | lists them, marked (Q4, R2) |

*Inferred from the source reads above; the "today" column verified by experiment (research F1, probe C2 and C4).*

### 2.3 The window between the edit and the apply

The reload runs in the revision's content part, the reconcile in its runner part: the composite's `invalidate` reports the project, and `fetchRunnerPart` then reads the environments and the listing again (`refinement.ts:123`, `:133`). The removal is written when `applyRunnerPart` commits. Until then a status read shows the project's files as before, at the new revision. The runner part's calls are bounded (C4, 666 s by default); a node:test listing is a directory walk. *Read in source code.* No status-side filter is proposed: status cannot know Vitest's project names without loading Vitest, and the window is the one every revision's runner part has.

### 2.4 Runs in flight

Tiers in flight are not blocked by a runner part, and no tier is selected while one is pending (C4). A node:test lane holds every node:test project together, so one tier can hold files of a removed project and of a kept one. The composite runs its members' parts one after another (`composite-runner.ts`, `run`). Under Q2 (a), the composite stops the removed member's part in flight with that part's own stop signal, as `squeal stop` stops one (`RunOptions.stop`, `runner.ts:221`; the node:test run stops its processes and reports only completed files), and skips a part not yet started. The kept members' parts run and store as before. *Read in source code; the stop path itself is C9's, not new.*

A recreated (changed) project's run in flight is not stopped. Its results are true for the entry it ran under, and the stability check stores them under the key it ran under or discards them, as C4 says; the file is then a miss at its new key. *Inferred.*

### 2.5 Other worktrees

Results and closures live in the shared store (C7), and the node:test observed-path rows (`node-test-observed:<project>`) are per project, not per worktree. Another worktree whose file still has the project keeps all of them: R1 removes only this worktree's `test_file_keys` rows and states. *Read in source code.* An observed-path row whose project no worktree has stays until a later row prunes `meta`; this design adds no pruning.

### 2.6 History outside the active configuration

`squeal failures` reads stored failing results by their provenance worktree (`status/failures.ts:39`), not by keyed files, so it lists a removed project's failures today and after a restart (probe: `[gone]` at revision 2 listed after the restart). Results under no live key are pruned once older than `store.retentionDays` (`prune.ts:48`: a key is live while some worktree's `test_file_keys` row holds it). So history decays as a deleted file's does. *Read in source code; verified by experiment for the listing.*

Under Q4 (a), R2 marks each listed failure whose test file has no `test_file_keys` row in its own worktree: `not a test file here now`, and `active: false` in the JSON. The mark covers a deleted file, a removed project and a renamed one alike, since all three leave the worktree without a key for that `(project, path)`.

## 3. A renamed or changed project (brief question 3)

### 3.1 One rule covers every entry change

The reconcile compares each entry of the file with the one its runner was built from, by name, over every field (canonical JSON, as the Vitest adapter's `excludedStamp` compares its lists). Whether a file then runs again is the key's business, not the reconcile's:

| Change | Reconcile | Keys | Tag |
| --- | --- | --- | --- |
| entry removed | remove | its files forgotten | read in source code |
| entry added | add | new files, queued as never-run files (C4 step 4) | read in source code |
| `argv`, `env`, `node`, `cwd`, `include`, `exclude` | recreate | the environment hash holds each of them (`adapter-environment.ts:71`), so every file of the project re-keys and runs, as after a restart (probe: `keep` after the restart) | read in source code; verified by experiment at restart |
| `include` or `exclude` | recreate | files that leave the listing are forgotten, files that join are new | read in source code |
| `cwd` moved | recreate | paths are root-relative, so a file under both roots keeps its path; its key moves with the environment | read in source code |
| `slow` (node:test, pytest), `batchSize` (pytest) | recreate | not in the environment hash: no key moves, nothing runs; the lane is already live (`slowView`) | read in source code |
| entry renamed | remove the old name, add the new | a check id names its project, and the environment hash holds the name, so nothing is inherited from the old name: the files run under new ids (probe: `[gone2]` after the restart) | verified by experiment at restart |
| two names swapped, or a name moved between node:test and pytest | removes before adds | the composite throws when two members report one project (`composite-runner.ts:31`), so the order matters | read in source code |

### 3.2 What the rule does not cover, and needs no rule

- **A Vitest project removed in the Vitest config.** The config is a recreate trigger already; the same relist forgets its files (013 V8). *Read in source code.*
- **`vitest.excludeProjects`, `vitest.exclude`.** Covered since 001-349 and 004-81 (section 1).
- **A removed project's files that the Vitest config's `include` matches.** They are Vitest's files under another project name, listed by Vitest whether or not node:test lists them, so they stay Vitest's after the reload as after a restart. *Inferred from the composite's listing (`composite-runner.ts`, `testFiles`).*

### 3.3 What needs its own sentence

- **The set of runners** is decided at start: Vitest is built when detected or when no other runner is configured (003 D7). A reload that removes the last node:test project in a repository without a Vitest config does not build Vitest, and one that adds the first does not remove it. Named as a start-time decision. *Read in source code.*
- **An unparsable file**, Q3.

### 3.4 An unparsable file (Q3)

The loader never throws: a file that cannot be read, is not JSON or is not an object gives the defaults with one problem (`config-file.ts:43` to `:59`). Under Q3 (b) every node:test and pytest project would be removed by a partial save, its told failures delivered as resolved, and every file listed again at the next save, where the lookup finds the stored results (C4 step 3), so nothing runs but the deliveries churn. Under Q3 (a) the daemon keeps its project lists for such a file. A file that parses applies as written, so an entry with a problem is skipped, as at a start (003 D1). The start's own behaviour is unchanged: a daemon that starts on an unparsable file has no lists to keep (probe, restart on C5). *Read in source code; the start verified by experiment.*

## 4. Keys, stored rows and the code (brief question 4)

### 4.1 011-37's rules

- **No key changes its composition.** A node:test or pytest environment hash is per project and holds that project's entry only. The composite's joined `adapterVersion` and `name` are not hashed (`keys/environment.ts:71` hashes the project environment's own adapter version). Removing a member re-keys no other project. *Read in source code.*
- **A row is written and accepted as a fresh daemon writes and accepts it.** For a given file, a reconciled daemon computes the key a daemon started on the same file computes, and the accept rule, the store decision and the stability check are unchanged. 011-37's raise rule ("only when a row an earlier release stored would be written or accepted differently") is not met. *Inferred.*
- **The alarm stays silent.** R1 changes `src/core/daemon/` and the policy loader; R2 changes `src/core/status/failures.ts` and its formatter. None of these is in a validity entry (`test/keys/validity/entries/`: the node:test and pytest entries leave out `node-test-runners.ts` and `pytest-runners.ts` by name). R1 does not touch `src/runners/node-test/` or `src/runners/pytest/`, so `NODE_TEST_ADAPTER_VERSION` and `PYTEST_ADAPTER_VERSION` stay. `test/keys/key-format.test.ts` decides. *Read in source code.*
- **No stored row changes meaning.** `test_file_keys` rows are removed as at a start; results, closures and `meta` rows stay. `failures --json` gains one additive field. *Read in source code.*

### 4.2 The code rows

**R1: a reload reconciles the node:test and pytest projects (C10 as amended).**

- Seams: `createCompositeRunner` (`src/core/daemon/composite-runner.ts`) reads its members at each call instead of a fixed array, and before `invalidate` fans out it asks its project sets to reconcile; a removed member leaves the owners map, its part in flight is stopped (Q2) and it is closed once that part ends. `createNodeTestRunners` and `createPytestRunners` become sets built from a getter of the live entries (`() => this.#policy.nodeTest`), keyed by name with a stamp of each entry; `reconcile()` returns the removed, added and recreated names, which the composite reports as `recreatedProjects`. `daemon.ts` passes the getters (`:430`, `:470`, `:480`). `#reloadPolicy` keeps the previous `nodeTest` and `pytest` when the file did not parse (Q3): `LoadedPolicy` gains an additive `unparsed?: true` (`src/core/types/policy.ts`), set by `loadConfigFile`.
- First edit, a lead: the composite's `invalidate` with a member set whose getter returns one entry fewer, and a unit test that the next `testFiles()` omits that project and `recreatedProjects` names it. The scheduler path after it (`applyListing`, `removeFile`, the `gone` decision) exists.
- Owns: `src/core/daemon/composite-runner.ts`, `node-test-runners.ts`, `pytest-runners.ts`, `daemon.ts` (the wiring and `#reloadPolicy`), `config-file.ts`, `policy.ts`, `LoadedPolicy` in `src/core/types/policy.ts`, their tests. Not yours: `src/core/scheduler/` (ask if a test shows it needs a change), `src/runners/`, `src/core/status/`, `src/cli/`, spec text, the board, bundles.
- Done when, tests first and red before, each through a real daemon with node:test projects:
  1. **Removed.** `keep` passes, `gone` fails and its failure was told; `squeal.config.json` without `gone` at a new revision: after that revision's runner part, no `test_file_keys` row and no known state of `gone`, `Known failures: 0`, the consumer gets `FAIL -> no longer reported by the runner` once, an edit of `gone/gone.test.mjs` queues nothing, `squeal retry gone/gone.test.mjs` exits 1, and `keep`'s key and state are as before, with no run.
  2. **Added.** A project added at a revision is listed, its file runs once and its result is current, with no restart.
  3. **Changed.** `keep`'s `env` changed so its test fails: its key moves, it runs and fails. A widened `include` lists the new file. A `slow` flag change moves no key and runs nothing.
  4. **Renamed and swapped.** `gone` renamed `gone2`: `[gone]` retired, `[gone2]` runs. Two entries swapping names reconcile without the "reported by both" error.
  5. **In flight.** A removed project's 8 s file in flight at the reload is stopped within the node:test cancel grace, and nothing is stored for it; a kept project's file in the same tier is stored. A changed project's file in flight finishes and is queued at its new key.
  6. **Unparsable.** Invalid JSON at a revision forgets nothing and notes the problem; the next valid save reconciles.
  7. **Retries.** A pending retry of a removed project's file is released, and status lists no pending retry for it.
  8. **Probe.** `probes/run.sh` against the candidate's bundle: C1 to C4 take effect without a restart (landing note, with the load).
  9. `test/keys/key-format.test.ts` passes with no raise; existing `test/daemon/` and `test/scheduler/` tests pass unchanged or each change is named.

**R2: `squeal failures` marks history outside the active configuration (C6 as amended, Q4 (a)).**

- Seams: `readFailures` and `formatFailures` (`src/core/status/failures.ts`): one `test_file_keys` lookup per listed row, in the row's own worktree; the text adds `not a test file here now`; the JSON adds `active: boolean`. Owns those, the payload type, their tests. Not yours: the store's results repository, `src/core/daemon/`.
- Done when: a deleted test file's failure and a removed project's failure are marked, a keyed file's failure is not; `--all-worktrees` judges each row by its own worktree; `--json` carries `active`; the 20-row cap and the total are unchanged.

R1 and R2 own disjoint files and can run side by side. R2 does not need R1: a deleted file already leaves history today.

## 5. Spec text (drafts)

**C10, first paragraph**, the end of its first sentence replaced:

> ..., the daemon persists one note and keeps running, and a revision that changes the file reloads it: it re-keys what `inputs` and `env.allowlist` touch and reconciles the projects (below).

**C10, a new paragraph after the keys' Note:**

> **Projects at a reload** (011-62, gh-53). A revision that changes `squeal.config.json` reconciles the daemon's `nodeTest` and `pytest` projects with the file, as a moved `vitest.excludeProjects` or `vitest.exclude` recreates the Vitest instance. A project the file no longer has is removed: its runner is closed and the test file list is read again, so its files are forgotten as a deleted test file's are. Their keys and known states in this worktree go, their queued work and retry claims go, a failure told to a consumer is delivered once as resolved (C5), `squeal retry` refuses them, and an edit of them runs nothing. A run of them in flight is stopped as `squeal stop` stops one (C9), and nothing it reports is stored. A project the file adds is built and listed, and its files are new test files (C4 step 4). A project whose entry changed in any field is recreated: its environment and its listing are read again, so its files' keys move only where the environment hash moves (003 D1), as at a daemon start; its run in flight finishes under the stability check. A rename is a removal and an addition: a check id names its project, so the files run under the new name and inherit nothing from the old one. A reload of a file that cannot be read, is not JSON or is not an object keeps the projects as they were; an entry with a problem is skipped, as at a start. Which runners the daemon builds (003 D7) is decided at start only. A removed project's stored results stay in the store, outside the active configuration, until pruning (C7). Other keys a reload applies: `observe.runtimeInputs`, `runner.*`, `slow.*`, `daemon.*` and `store.*` at their next use; the hook-side keys at each hook call; `capacity.*` only at start (Capacity).

**C6, in 2026-10-15's amendment**, after "It lists failures still stored, not every failure ever seen.":

> A failure whose test file its worktree has no key for, a deleted file or a project the configuration no longer has (C10), is marked `not a test file here now`, and its JSON carries `active: false` (011-62).

**003 D7**, one sentence for the 003 coordinator: "The runners built per configured project follow a reload of `squeal.config.json` (011 C10 as amended, 011-62)."

## 6. Rejected options

- **Rebuild the whole composite at a reload.** It drops the warm Vitest instance and its slow twin, and lanes in flight lose their runner. The Vitest exclusion precedent recreates only what moved.
- **Keep removed projects' states, marked (Q1 (b)).** A new validity or field in `known_states`, read by status, the header, Stop, `run --all --wait` and every harness. The issue offers it; the history it would keep is already in the stored results.
- **A status and retry filter only (Q1 (c)).** The daemon keeps running the project and counts it in its own deliveries and Stop. Status cannot judge Vitest projects without Vitest.
- **Restart the daemon on a project change.** A restart re-reads every closure and re-runs the baseline lookup, drops queued work's classes and costs the agent a stop and a start; C9's restart paths were built for upgrades.
- **A reload outside a revision** (a timer that re-reads the file). The file is a tracked path; a revision already carries every change to it.

## 7. Limits and open questions

- The Vitest exclusion path is verified by its adapter test and read in source code at the scheduler level; no Vitest end-to-end probe ran here (this worktree has no `node_modules`).
- A pytest project was not probed. Its runners are built as node:test's are (`pytest-runners.ts`), so the same rule and the same seams apply. *Inferred.*
- After a restart, status printed `all 3 test files current` with the predecessor's `[gone]` FAIL before the new daemon listed its files (probe, `squeal start` on C4; research open question). C6 allows that clause only once the files are listed. This is a status question beside this row, for the coordinator to triage; R1 makes the restart unneeded for a project change.
- At C2 a `status --wait` noted that the daemon's heartbeat went 12 s stale while its socket answered, at load about 10. One occurrence, not attributed.
- An observed-path `meta` row of a project no worktree has is never pruned (2.5). Small, and outside this row.
