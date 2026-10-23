# 011-135: focused checks inside one test file, a design for the human

Board row 011-135, a docs-only design draft (brief: `tasks/wave-22.md`, section D1; gh-64, [#64](https://github.com/hearsay-tools/squeal/issues/64)). The human approved the row on 2026-10-23 (`docs/triage/2026-10-23-digest.md`, group C, "Design row"). No code row starts before the human accepts this design.

Nothing here is in `spec.md` until the human accepts it. On acceptance, the drafts in section 7 go into 011 C4, C5, C6, C14 and C15 and 013 V4, with one sentence each for 003 (node:test) and 007 (pytest); `status.md` gets a dated line, and the board numbers the code rows of section 8. Workers write no spec text (wave 22's rule): section 7 is the coordinator's input.

Sources: board row 011-135 and Triage row gh-64; the digest's group C; `research/issue-64.md` and its probe; `research/running-tier-yields.md`; 011 C4, C5, C6, C14, C15 and `status.md`; 013 V1 and V4; issue #64 with its comments and cezarion#1269 (read 2026-10-23). Source read at `e81754965` (main): `src/core/types/runner.ts`, `src/runners/vitest/{adapter,run}.ts`, `src/runners/node-test/{identity.ts,run/run.ts}`, `src/runners/pytest/{run/command.ts,run/report.ts,runtime/squeal_pytest.py}`, `src/core/scheduler/{rerun,ledger}.ts`, `src/core/state/{file-class,check-name}.ts`, `src/cli/{status-wait-paths,status-wait-promote}.ts`, `src/core/daemon/handlers.ts`, `src/core/store/{schema,open}.ts`, `src/core/types/store.ts`, `src/core/status/failures.ts`.

Evidence tags: `measured` (an experiment of this row, under `probe/`), `read in source code`, `read in official docs`, `inferred`. Reporter evidence from an issue is named as such.

**Probe.** `probe/` holds every script; `probe/README.md` says what each does. Each run used a scratch root `/tmp/d1-135-G7Vho2` with `HOME`, every `XDG_*` directory, `TMPDIR`, the npm, pnpm and corepack homes under it. No Squeal daemon was started or reached, and no script under `evals/bin/` ran. The cezarion clone is `/tmp/d1-135-G7Vho2/repo` at `6a4db210`, the first commit of cezarion PR 1384, which closed cezarion#1269 and holds the two changed assertions. The brief's "PR 1269" is issue 1269; PR 1384 is the change that issue's task made (read in GitHub: the issue's closing event names PR 1384).

## Summary

- **The selector is `--check <text>` on the named wait.** `squeal status --wait <ms> <test file>... --check <text>...` selects the checks of each named test file whose full name holds a text, as `squeal failures --check` selects stored failures. The daemon runs those checks first, in a run of their own, and the wait returns with their outcomes. The file's own run follows, as today.
- **Focused evidence is never a result.** It lives in one `focused:<worktree>` meta row, the newest focused run of each test file. It is never stored under a key, never current, never a known state, transition or known failure, never part of a checkpoint and never a duration estimate. Status, `why` and the wait show it on lines of its own, labelled `focused`, only while the file's key is the one it ran at and the file has no result there.
- **The runner contract gains one additive option, `RunOptions.checks`.** Each runner has its own name filter: Vitest's per-file `testNamePattern` (4.1.10 and 5.0.3), node:test's `--test-name-pattern` (Node 24.21) and pytest's deselection hook (9.1.1). The adapter reports only the selected checks. Vitest reports every check its filter leaves out as `skipped`, so the adapter must drop those, or they would read as skips.
- **A focused red is not re-run, and C5 is unchanged.** The file's own run is the final verification, and its new failure is re-run once as today.
- **A focused run is a tier of its own, first in its lane.** A running tier yields to it as to a promoted file (C4 step 5). The file stays promoted, so its own run leads the next tier.
- **The gain, measured on cezarion#1269's parity files.** On the codex file at a load near 16, the whole file ran in 119.7 s and `vitest -t` on its two changed checks in 6.4 s and 6.3 s, with the same two failures: 19 times faster. Today's daemon red on that file is two whole runs, about 236 s; a focused red would come about 8 to 19 s after the edit (inferred from the measured parts, section 6.3). Two more files ran whole under higher load (443.1 s and 242.8 s). The host's load kept four files, the warm-instance runs and the green from running.
- **Three code rows**: the runner contract (R1), the scheduler and the meta row (R2), the CLI and status (R3). R2 and R3 follow R1.

## Decisions for the human

One recommendation each. The spec text in section 7 follows the recommendations.

| # | Question | Options | Recommendation |
| --- | --- | --- | --- |
| Q1 | How does the agent select the checks? | (a) `--check <text>`, repeatable, on `status --wait <ms> <test file>...`: a literal part of the check's full name, as `failures --check`. (b) A command of its own, `squeal focus <test file> --check <text> [--wait <ms>]`. (c) A regular expression, `-t <pattern>`, as Vitest's. | (a). The named wait already selects the file, promotes it, syncs with the daemon and reads the result (C15). The focus is a narrower first answer of the same wait. A literal text reads the same in all three runners, whose own filters differ (section 3). Section 1. |
| Q2 | Where does focused evidence live? | (a) One `focused:<worktree>` meta row: the newest focused run of each test file, bounded. (b) A new store table. (c) The daemon's memory and the run's log only. | (a). The store has been at schema 1 since the first release, an older Squeal refuses a newer schema, and two releases share one store on this host every day. So (b) locks out the other plugin. (c) needs the daemon for every read, and status reads the store without one (C6). Section 2. |
| Q3 | What does the runner contract add? | (a) `RunOptions.checks`, per test file, with an adapter capability `RunnerAdapter.focuses`. The adapter applies its runner's own filter and reports only the selected checks. (b) A new method, `runChecks(file, texts)`. | (a). Additive, one path through `run` with its timeout, cancel, lanes and sweep. Every current adapter can implement it (section 3). An adapter without the capability gets no focused run. |
| Q4 | Is a focused red re-run before it is trusted (C5)? | (a) No. A focused red is a first run, said so, and never enters C5. The file's own run follows, and C5 re-runs its new failure as today. (b) The focused red counts as C5's first run: a fail of the same check at the same key in the file's own run is not re-run. (c) The focused red is re-run once before the wait returns. | (a). The issue keeps final verification unchanged, and (a) changes nothing in it. (b) saves one whole-file run per new red at the final verdict (section 6) but changes C5's trust rule; it can be a later row. (c) adds a run to a red the agent usually expects (test first). Section 4. |
| Q5 | Where does a focused run go beside the file's own run? | (a) A tier of its own, before every other class in its lane. A running tier yields to it as to a promoted file. The file stays promoted, and its own run comes next. (b) The selected checks first inside the file's own run. (c) A second runner instance beside the lane. | (a). (b) is not possible in Vitest: a run takes one specification per module (inferred from the API, section 5). (c) doubles a large instance's memory for a run of seconds. Section 5. |
| Q6 | What does the wait return, and with which exit status? | (a) It returns at the focused outcome: exit 1 when a selected check failed, 3 when none did. A focused pass is not a verdict. A file already current answers as a named wait does today, 0 or 1. (b) As (a), but exit 0 on a focused pass. | (a). "Focused passes never mark unexecuted checks, files or checkpoints passed" (#64). Exit 0 means a verdict in every other wait. Section 1.4. |

Cheaper, for comparison: no focused runs, and a named wait returns at a new failure's first run, with "re-run queued" in place of holding through C5's re-run. It halves today's red on a large file, needs no runner change, and does not help a green. Section 6 gives its numbers beside (a).

## 1. The selector (Q1, Q6)

### 1.1 Today

- `status --wait` takes paths only. A check name given as a path selects nothing: "No verdict: no test file's closure holds ..." (measured in `research/issue-64.md`, phase C, on 0.1.233; at 0.1.273 still so, read in source code: `status` in `src/cli/main.ts:242` takes no name option, and `src/cli/status-wait-paths.ts` resolves paths only).
- `squeal failures --check <text>` keeps the stored failures whose printed name holds the text (read in source code: `src/core/status/failures.ts:139`). The printed name is `[project] <path> > <full name>` (`formatCheck`, `src/core/state/check-name.ts:19`).
- No runner can run part of a file: `RunOptions` has no name filter (read in source code: `src/core/types/runner.ts:215-275`).

### 1.2 The rule

`squeal status --wait <ms> <path>... --check <text>...`

- `--check` applies to each selected test file whose own path was named, as promotion does (C15, "What is promoted"). A source path selects no focus, since it reaches every consumer of the path. With only source paths, `--check` is a usage error: `--check selects checks inside a test file named by its own path`.
- A text is literal. It selects a check of that file when the check's full name holds it. The full name is Squeal's check identity (013 V4: `describe > ... > test`, with the duplicate-line suffix). The path and the project are not part of the match, since a runner's filter cannot see them, and a text such as `parity` would select every check of `waits-claude-parity.test.ts` through its path. A text that begins with the file's own printed prefix (`[project] <path> > `) is read without it, so a name copied from a failure line works.
- Several `--check` texts: a check that holds any one is selected, as in `failures --check`.
- Without `--wait`, `status <path>... --check <text>` reads only. It shows the stored focused evidence and the stored results of the selected checks, and requests nothing, since a status read writes nothing (C6).

*Read in source code* for the current rules cited; the rule itself is a proposal.

### 1.3 Why not a regular expression or a command of its own

- **One literal rule for three runners.** Vitest's and node:test's filters take a regular expression, pytest's `-k` takes an expression language of its own (section 3). A literal text maps to each of them exactly, with a post-filter on Squeal's own full name. A regular expression does not map to pytest. *Read in official docs* (pytest `-k`), *measured* (section 3).
- **The wait is the agent's one command for "what does this file say now"**. It selects, promotes and syncs (C15, 005 D2). A new `focus` command would repeat each of those. *Inferred.*
- **`retry` is not the place.** It queues one more full run of a file at the same key (C5, gh-36), and it does not wait.

### 1.4 What the wait returns

The wait gets a new outcome, `focused`. It returns once each named file with a text has one of:

1. focused evidence at the file's current key (a focused run ended);
2. a stored result at that key that holds the selected checks (the file's own run ended first, or its first fail awaits C5's re-run);
3. a focused run that selected no check: `No check of <file> holds "<text>" at revision N (the run collected 78 checks).`

Exit status: 1 when a selected check failed; 3 when none did, since a focused pass says nothing of the file's other checks; 3 for a selection that matched nothing. When the file is current at its key before any focused run, the wait is a named wait as today, with the selected checks named from the stored result, and exits 0 or 1. The rest of the wait's text (classes, the verdict line) is the named wait's, with the file still pending.

The text, drafted for the red of cezarion#1269 (the names shortened here only):

```
Focused: 2 checks of packages/cezar/src/workflows/waits-claude-parity.test.ts at revision 4, run alone in 7.8 s; not the file's verdict.
  FAIL wait list on every native runner wire (hearsay-tools/cezarion#1233) > claude U2 ci and timer open: ...
    AssertionError: expected 'Timer ... fired: u2. ...Still open: CI wait ...' to contain '\n\nStill open: CI wait ...'
    at packages/cezar/src/workflows/waits-parity-cells.testkit.ts:302:22
  FAIL wait list on every native runner wire (hearsay-tools/cezarion#1233) > claude U3 a human message during a ci wait is delivered, ...
    ...
  A first run each, not re-run; the file's own run (78 checks) decides.
Pending (1):
  packages/cezar/src/workflows/waits-claude-parity.test.ts: queued, promoted; no tier running in its lane
Focused: 2 of 2 selected checks failed; no verdict for the file yet: `squeal status --wait 600000 packages/cezar/src/workflows/waits-claude-parity.test.ts` waits for it.
```

`--json` adds `focused` to the wait's payload: per file, `revision`, `key`, `texts`, `runId`, `durationMs`, `matched`, `collected`, and each selected check's `name`, `outcome`, `summary`, `location` and `durationMs`. `selection.outcome` reads `focused`. Additive; `schemaVersion` unchanged.

**An older daemon.** The CLI sends the focus as a new request beside the promotion (section 5). A daemon that does not know it answers unknown (as for `promote`, read in source code: `src/core/daemon/handlers.ts:285`). The wait then says on its first line `this daemon (Squeal <version>) runs whole files only; waiting for the file's run` and reads as a named wait.

## 2. Where focused evidence lives, and how status and `why` show it (Q2)

### 2.1 Today

- A result row is `(check_id, key)` (`results`), a known state is `(worktree_id, check_id)` (`known_states`), and both feed transitions, delivery, `Known failures`, checkpoints and the tier estimate. *Read in source code* (`src/core/store/schema.ts`).
- The schema has one migration. `SCHEMA_VERSION = MIGRATIONS.length` is 1, and `connect` refuses a store whose `user_version` is newer than its own (`src/core/store/schema.ts:207-211`, `src/core/store/open.ts:72`). *Read in source code.* Every Squeal on a repository shares its store, and on this host two plugin releases at once are the usual state (digest group A: "Claude Code has squeal 0.1.270 and Codex has 0.1.269"). So a new table (schema 2) would make every older Squeal of that repository refuse the store. *Inferred.*
- Every per-worktree record added since went into a `meta` row registered in `WORKTREE_META_ROWS`: `promotions:`, `yields:`, `reruns:`, `merge-hold:` and 45 more, each removed with its worktree (`WorktreeRepo.remove`; `src/core/types/store.ts:350-406`). *Read in source code.*

### 2.2 The row

`focused:<worktree>`, owner `scheduler/focused`, one JSON list. One entry per test file, its newest focused run only, at most 20 files (the oldest entry goes first):

| Field | Meaning |
| --- | --- |
| `testFile` | the file (project, path) |
| `key` | the file's key when the run started |
| `revision` | the revision the run started at |
| `texts` | the `--check` texts it ran for |
| `runId`, `logDir` | the run, whose log keeps the full output, as for any run |
| `startedAt`, `endedAt` | `endedAt` is `null` while it runs |
| `end` | `completed`, `discarded` (an input changed during the run, with the reason), `crashed`, `timed-out` or `cancelled` |
| `collected`, `matched` | the checks the runner collected in the file, and how many held a text |
| `checks` | each selected check: identity, outcome, duration, summary, location, fingerprint; at most 50, with a count of the rest |

The daemon writes it twice per run: at the start, `endedAt` null, and at the end. It changes nothing else. The row goes with its worktree, as every row of `WORKTREE_META_ROWS` does (read in source code: the list's comment, `src/core/types/store.ts:350-355`). A text that selects a whole file runs the whole file, but its results still go only here (inferred: the runner cannot know the match count before it collects).

What the entry never is, and what keeps it so (each to be checked by R2's tests):

- **Never a keyed result.** The record path of a focused tier writes no `results` row, so step 3's lookup, inheritance and other worktrees never see it.
- **Never a known state, so never current, stale or pending, never a transition, never a known failure, never delivered.** `known_states` is untouched, so `fileClassOf`, `Known failures: N`, the hooks' deltas and Stop read nothing of it. Principle 1 holds: a focused run is news only to the wait that asked for it.
- **Never a checkpoint.** `run --all` and the checkpoints read results and key rows, not this row.
- **Never a duration.** The scheduler's estimate reads stored results (`durationOf`, `src/core/scheduler/files.ts:161`), and a focused run's module time covers only what ran (measured: Vitest's own test time of a focused parity run was 3.4 to 4.8 s, against 116 to 438 s for the whole file, section 6.2).
- **Never a closure change.** A focused run's `observed` paths and `reads` are dropped. The file's own run observes the same paths when it runs. *Inferred:* every path a focused run reads, the file's own run reads too, unless the skipped checks change what the file imports, which only the whole run shows.
- **Never a claim** (C7). It stores nothing at a key, so it claims none and waits for none.

### 2.3 How status and `why` show it

An entry *applies* while its `key` is the file's current key and the file has no result at that key, that is, while the file is pending. Otherwise its file's own result, or a newer key, supersedes it.

- **`squeal status`**, after the earlier-failures line and before `Affected checks`: one line per file whose entry applies, at most 3, then `and N more`:
  `Focused (not counted): packages/cezar/src/workflows/waits-claude-parity.test.ts at revision 4: 2 of 2 selected checks FAIL (claude U2 ci and timer open: ..., claude U3 a human message ...); its own run is queued.`
  With `--full`, the selected checks one per line. A focused run in flight reads `running since HH:MM:SS (focused: <texts>)` in the running-files list (C6, row 011-58), and the file's checks are not counted as running.
- **`squeal status --json`** adds `focused`, an array of the entries with `applies` per entry. Additive; `schemaVersion` unchanged.
- **`squeal why <check>`**, for a check with an entry: one line below the known state, `Focused run at revision 4 (7.8 s, log <dir>): FAIL, not a stored result; the file's own run decides`, then `its key moved since` when the entry no longer applies. `--json` adds `focused`.
- **`squeal failures`** lists nothing of it: a focused failure is not a stored failure.
- **The hooks and Stop** say nothing of it.

### 2.4 Rejected

- **A table.** Schema 2 makes every older Squeal of the repository refuse the store (2.1).
- **The daemon's memory and the run log only.** Status and `why` read the store without a daemon (C6), and the wait would need a new socket query. A focused result would also vanish with a daemon restart, while the agent is still reading it.

## 3. The runner contract (Q3)

### 3.1 Today

`run(files, RunOptions) -> RunReport`. `RunOptions` holds `runId`, `logDir`, `timeoutMs`, `signal`, `stop`, `lane`, `childEnv`, `observeIgnored`, `workers` and `fileEnded`: no name filter (read in source code: `src/core/types/runner.ts:215-275`). 013 V4's `run(testFiles)` calls `runTestSpecifications` on one specification per file, made by `project.createSpecification(path)` with no options (read in source code: `src/runners/vitest/adapter.ts:470-474`).

### 3.2 The addition

- `RunOptions.checks?: ReadonlyMap<string, readonly string[]>`: per test file (its `testFileId`), the `--check` texts. A file without an entry runs whole. Additive.
- `RunnerAdapter.focuses?: true`: the adapter honours `checks`. A runner without it gets no focused run, and the wait says `<runner> runs whole files only`. Additive.
- The contract, for a file with texts: run only the checks whose full name holds a text, through the runner's own filter, with the hooks the runner runs for them; report a result for those checks only, plus the file-level check when it failed (a load error, a hook that threw); report the run's own end, completed files and file errors as for any run. The scheduler keeps no duration, read or observed path of it (section 2.2).

Each runner's filter, and what it does with the checks it leaves out:

| Runner | Filter | What it matches | Checks left out | Tag |
| --- | --- | --- | --- | --- |
| Vitest 5.0.3 | `project.createSpecification(path, { testNamePattern })` | the full name joined by ` > `, Squeal's own: `parity > new 1` selects it, `^parity new 1$` selects nothing | reported by `onTestCaseResult` as `skipped`; the module state is `failed` or `passed` from the selected checks alone, `skipped` when none is selected | measured (`probe/filters.sh`, `results/filters.txt`) |
| Vitest 4.1.10 | the same option | the full name joined by a space: `parity > new 1` selects nothing, `^parity new 1$` and `^parity inner new 2$` select | as in 5.0.3 | measured |
| node:test, Node 24.21 | `--test-name-pattern=<regex>` | the ancestors' and the test's names joined by a space: `parity > new 1` selects nothing, `parity new 1` selects it; a suite's name selects its tests | not reported at all; a pattern that selects nothing reports the file itself as one passing test (`ok 1 - a.test.mjs`, `# pass 1`) | measured (`probe/filters.sh`) |
| pytest 9.1.1 | a hook in Squeal's plugin, `pytest_collection_modifyitems`, calling `pytest_deselected` | Squeal's full name, the node id after the first `::` (`src/runners/pytest/run/report.ts:151`) | not run, not reported, counted as deselected; the plugin already writes `deselected` events (`squeal_pytest.py:288`) | measured with a stand-in hook; read in source code |

So, per adapter (R1):

- **Vitest (013 V4).** The pattern is each text escaped as a regular expression, with each ` > ` in it read as ` > ` or a space, `(?: > | )`, the texts joined by `|`. It matches both versions' joins. The adapter then keeps only the results whose `fullName` holds a text, and drops every other result the run reports, the filter's `skipped` ones first. Without that drop, each unselected check would read as a skip. The pattern is set on the specification, never with `setGlobalTestNamePattern`, which is the instance's for every later run. *Read in source code* (both versions' `TestSpecificationOptions`: `testNamePattern`, `testIds`, `testLines`, `testTagsFilter`), *measured* (both joins, the skipped reports). `testIds` is rejected: Vitest's positional ids hold only within one run (013 V4), and a check just written has none before it is collected. `testLines` is rejected: a check just written has no stored location, and the agent names checks, not lines.
- **node:test (003 D5).** `--test-name-pattern=<pattern>` before the file, the pattern built as for Vitest. The post-filter on Squeal's `fullName` (` > `, `src/runners/node-test/identity.ts:14`) drops what the regex let through. A check the pattern leaves out is not in the stream, so it is not reported. A pattern that selects nothing makes Node report the file as one passing test, so the adapter counts its own matches and reports `matched: 0`, never a pass of the file. *Measured* on Node 24.21. Older Node versions were not checked; there the option exists, and whether it matches the ancestors' names is not known. A miss there selects nothing, and the wait says so (1.4, case 3).
- **pytest (007 D6).** The adapter passes the texts in a variable (`SQUEAL_PYTEST_CHECKS`, JSON). `squeal_pytest` deselects every collected item whose full name holds no text, through `pytest_deselected`, so pytest's own accounting stays right. *Measured* with a stand-in hook on pytest 9.1.1: `2 passed, 1 failed, 2 deselected`, and only the selected checks reported. `-k` is rejected: an expression language, matched case-insensitively against names, parents and markers, so it is not the same rule (read in official docs). Node ids on the command line are rejected: they select exactly (measured), but they need each parametrized id spelled out.

## 4. The re-run of a first-seen fail (Q4)

### 4.1 Today

C5: a worktree's own new failure is delivered at once, then its file is queued forced, and a second fail is trusted. A named wait holds through that re-run: `queueReruns` enqueues the file (`src/core/scheduler/rerun.ts`), `enqueue` writes the key row's pending phase (`ledger.ts:436-446`, `#syncPhase`), `fileClassOf` reads the file `pending` while that phase is set (`src/core/state/file-class.ts:29`), and `decidedOutcome` returns `null`, so the wait keeps waiting, while `pending` is not 0 (`src/cli/status-wait-paths.ts:236-243`). *Read in source code.* That is why issue-64's daemon red took 25.4 s for a 12.3 s file: two whole runs (measured there; the cause inferred there, and the source now shows the mechanism).

### 4.2 The recommendation: (a), no re-run, and C5 unchanged

A focused red is said once as a first run: `A first run each, not re-run; the file's own run decides.` It never enters C5: it is not a known state, so it is neither a new failure nor a failing state that would spare the file's own failure its re-run. The file's own run follows. When it fails, C5 delivers that failure at once and re-runs it once, as today. *Inferred* from section 2's rules.

Why: the issue asks for an early red or green with final verification unchanged, and (a) changes no line of the final verification. The red an agent asks for in a large file is usually the one it expects (the issue's own case: a new assertion written before the fix). Confirming it gains little, and a flaky red still meets C5 at the file's own run.

### 4.3 The options not recommended

- **(b) The focused red counts as C5's first run.** When the file's own run stores a fail of a check that a focused run failed at the same key, it is trusted without a re-run, as a fail that replaces another worktree's fail is (C5). Gain: one whole-file run per new red at the final verdict; on the parity files that is the whole-file time of section 6. Cost: a change to C5's trust rule, with a focused run as one of its two runs, in a context where the other checks of the file did not run. A later row can take it with the human's choice.
- **(c) Re-run the focused red once before the wait returns.** Cost: one more focused run (section 6), on a red the agent usually expects.

## 5. Its lane and order beside the file's own run (Q5)

### 5.1 Today

C4 step 4 ranks work an edit caused first; C15 ranks a promoted file first in that group. Tiers run one at a time per lane (Vitest one lane, node:test another). A running fast Vitest tier yields, once per file and key, when an edit's work or a promoted file waits in its lane and its estimated remainder exceeds 30 s, never in the backlog's turn (C4 step 5, row 001-381; C15). node:test and pytest tiers run to their end, and an edit's tier of those lanes starts beside their backlog tier (row 011-21). *Read in spec.*

The common case of #64 is the file's own tier in flight when the wait arrives: the edit re-keys the file, its tier starts at the next boundary, and the agent's wait comes a tool call later. *Inferred* from C4 step 5 and the issue's timeline (the first tier started at 23:00:19Z; reporter evidence).

### 5.2 The rule

- **The request.** The CLI sends `focus` (the test files named by their own paths, the texts, and the time left of the wait) beside the `promote` it sends today, once, at the first decided read (C15, "Older daemons"). The daemon keeps a focused entry per file in its memory until the wait's deadline, as it keeps a promotion. A daemon restart drops it; the wait then waits for the file's run, and says so at its end.
- **The rank.** A file with a focused entry at its current key goes before every other class in its lane, promoted files included. A focused tier holds only focused entries of one lane, up to `runner.tierSize` files, each run for its own texts. It is never the backlog's, and it counts toward the four first-group tiers after which the backlog gets its turn, so a stream of focused waits cannot starve the backlog.
- **The yield.** A running tier in the lane yields to a focused entry exactly as to a promoted file (C4 step 5: Vitest only, a remainder over 30 s, once per file and key, never the backlog's turn). When the cut tier holds the focused file itself, the cut loses the seconds it ran, and the file goes back queued, still promoted. A tier that does not yield runs to its end, and the focused tier follows it.
- **The file's own run.** It stays promoted until the wait's deadline, as today (C15, "Lifetime"), so it leads the next tier after the focused one, even when the wait has already returned.
- **Answered without a run.** When the focused tier would start and the file has a result at its current key (its own run ended first, or its first fail awaits C5's re-run), the entry is dropped, and the wait reads the selected checks from that result.
- **The stability check** judges a focused run as any other: when an input of the file changed during it, the entry ends `discarded`, and while the wait is open the focus is queued again at the new key, as a promoted file that becomes queued during a wait is promoted again (C15).
- **Constraints that still bind.** An unlisted revision starts no focused tier (C4, the runner part). A hold stops it (row 011-61), and the wait returns on hold as today. A claim does not hold it: it stores nothing at the key (C7). A slow file (004 D2) gets no focused run in the first rows: the wait says `slow file: focused checks run for fast files only` and names `squeal run --slow`. The slow lane takes a permit and runs only while no other tier runs; a later row can lift the limit on request.
- **node:test and pytest.** A focused tier there is an edit's tier, so it starts beside the lane's backlog tier (row 011-21). No yield applies.

### 5.3 Rejected

- **The selected checks first inside the file's own run.** A Vitest run takes one specification per module, and `testNamePattern` applies to the whole specification. Two specifications of one module in one run would run the module twice, with reports keyed by module (inferred from the API; not tried). A per-check result stored before the run ends is what C4's tier-sharing paragraph rejected (D12's crash rule and the post-run read checks).
- **A second runner instance.** On cezar a Vitest instance holds 110 to 114 MiB that a recreate frees (013 V1, row 013-06). A second one per worktree for a run of seconds is not worth it. *Inferred.*

## 6. The gain on cezarion#1269's parity files

### 6.1 What ran

The commit `6a4db210` changed two assertions in `waits-parity-cells.testkit.ts`, in the cells U2 (`<runner> U2 ci and timer open: ...`) and U3 (`<runner> U3 a human message during a ci wait ...`). Seven test files import the testkit: one per runner (`waits-{claude,codex,cursor,omp,opencode,pi}-parity.test.ts`, 78 checks each, run serially in their file) and `waits-parity.test.ts`, which holds the two guard checks only. *Read in source code* (cezarion at `6a4db210`). For the red, `run.ts` was put back at `6a4db210^`, so U2 and U3 fail in each runner's file as they did for the issue's author; for the green, at `6a4db210`.

Each file ran with the clone's own Vitest 4.1.10 CLI: whole (`vitest run <file>`), then focused (`vitest run <file> -t 'U2 ci and timer open|U3 a human message during a ci wait'`). Each run started only at a one-minute load below 16 on 24 CPUs; `probe/results/load-samples.txt` gives the load every 10 s during the runs, and `probe/summarize.py` pairs them. *Measured.* The host was shared with other sessions' test runs, and the load rose during some whole runs, as the table says.

### 6.2 Whole file against `vitest -t`

Every run gave the same red: whole, `2 failed | 76 passed (78)`; focused, `2 failed | 76 skipped (78)`. *Measured* (`probe/results/cli-red.txt`, `probe/results/summary.txt`).

| File | Whole: wall (Vitest's tests) | Load during the whole run: start, mean, max | `-t`: wall (Vitest's tests) | Load at each `-t` | Whole over `-t` |
| --- | --- | --- | --- | --- | --- |
| `waits-codex-parity.test.ts` | 119.7 s (116.3 s) | 15.6, 15.7, 20.2 | 6.4 s (3.5 s), 6.3 s (3.4 s) | 14.2, 14.0 | 19 times |
| `waits-claude-parity.test.ts` | 443.1 s (438.4 s) | 15.3, 33.0, 43.6 (no sample in its first 3 min) | 8.6 s (4.8 s), 7.8 s (3.8 s) | 14.1, 15.9 | 54 times, the whole run slowed by the load |
| `waits-cursor-parity.test.ts` | 242.8 s (233.7 s) | 13.9, 46.2, 84.9 | not taken | | |

Only the codex pair ran at a load near 16 throughout. Its ratio, 19 times, is the one to quote; the claude ratio is inflated by load during the whole run.

A focused run's time, from Vitest's own split: transform 1.7 to 2.5 s, import 2.2 to 3.2 s, the two checks 3.4 to 4.8 s, and 0.5 to 0.9 s of the CLI's own start. The two checks each start mock harness processes, so they are the larger part even alone. *Measured.*

**Not taken.** The load stayed above 16 from 07:59Z until the driver's two-hour bound at 09:21Z: 20 of the 680 samples between 07:27Z and 09:21Z were below 16, the median was 40.6 and the maximum 102.1 (other sessions' test runs; `probe/results/load-samples.txt`). So these did not run: the `-t` runs of the cursor file; the omp, opencode and pi files and `waits-parity.test.ts`, whole and focused; `warm.mjs`, the same comparison inside one warm Vitest instance, as the daemon holds it; and the green run. The scripts for them are in `probe/` and run as they are.

### 6.3 What the daemon would take

The model below takes the measured parts and the rules read in source. It is *inferred*: no daemon ran. W is the file's own run in the daemon's warm instance, about the CLI's whole run less its start: 118 s for the codex file. F is a focused run in that instance: about import plus the checks plus the per-run floor (013 V4, 110 to 350 ms), 6 s for the codex file; a warm instance keeps Vite's transforms, so the 1.7 s of transform probably drops (not measured: `warm.mjs` did not run).

- **Today**, a new red costs two whole runs, since the wait holds through C5's re-run (section 4.1): 2W. A green after the fix costs one, W: a pass is no new failure and is not re-run.
- **With focused checks**, counted from the edit as today's times are: the file's own tier starts at the edit, and the wait comes a tool call later, 2 to 10 s assumed here. The tier's remainder is then far over 30 s, so it yields; the cancel took 0.36 s at load 4.27 and p50 3.1 s at load 52 on cezar (`research/running-tier-yields.md`, finding 1); then F. So about 8 to 19 s from the edit, red or green, and the seconds the tier ran before the cut are thrown away.
- **The file's own verdict** comes after the focused run: later than today by F and the seconds the cut threw away under Q4 (a), and one whole run sooner under Q4 (b).

| Rule, on the codex parity file, from the edit | First red | First green | The file's verdict after a red |
| --- | --- | --- | --- |
| Today | about 236 s (2W) | about 118 s (W) | about 236 s |
| Cheaper: the wait returns at the first run's fail | about 118 s | about 118 s | about 236 s |
| Focused, Q4 (a), recommended | about 8 to 19 s | about 8 to 19 s | about 244 to 255 s |
| Focused, Q4 (b) | about 8 to 19 s | about 8 to 19 s | about 126 to 137 s |

On the claude file as it ran here (443 s at load 33 on average), today's red would be about 886 s and the focused one about 10 to 21 s.

**The incident.** One testkit edit re-keyed all seven files. Its first failures came 387 s after the first tier started (reporter evidence). That fits one tier of parity files that stores at its end (C4, row 001-184), whose longest file ran 387 s at that load; the measured files ran 120 to 443 s here. With focused checks on the six runner files, the focus fills two focused tiers of 4 and 2 files (`runner.tierSize` 4), each about as long as its longest focused run, 6 to 9 s here: the six reds in about 15 to 25 s after the cut. *Inferred*; a focused tier of several files was not measured.

## 7. Spec text, drafted

For the coordinator, on the human's acceptance. Each draft follows the recommendations Q1 (a) to Q6 (a). `<date>` is the acceptance date.

**011 C4**, after the first paragraph ("Validity is per check, not per run. ..."), one sentence:

> A focused result (C15) has no validity: it is never current, stale, unknown or pending, and it never says whether a check passes at a key (amended <date>, the human, row 011-135).

**011 C4**, a paragraph after the tier-sharing paragraph ("An edit's tier takes a file only beside files of a comparable last-known duration ..."):

> Amended <date> (the human, row 011-135, gh-64; `tasks/011-135/design.md`): a focused entry (C15) of a fast test file at its current key goes before every other class of its lane, promoted files included. A focused tier holds only focused entries of one lane, up to `runner.tierSize` files, each run for its own texts (C14, `RunOptions.checks`). It is never the backlog's, and it counts toward the four first-group tiers after which the backlog gets its turn. A running tier yields to a focused entry as step 5 says for a promoted file. A focused tier stores nothing under a key: no result, known state, transition, duration, closure, observed path, claim or discard count comes from it, and its outcome goes to the `focused:<worktree>` meta row (C5). The stability check judges it as any tier; an entry whose input changed during its run ends `discarded`, and while its wait is open it is queued again at the file's new key. An entry is dropped with no run when its file has a result at its current key. A slow file and a file whose runner lacks `RunnerAdapter.focuses` get no focused entry. Measured by `test/scheduler/focused.test.ts`: with a tier of 4 files of 200 s known in flight and a focused entry queued in its lane, the tier yields, the focused tier runs only the selected checks and stores no result, and the file's own run leads the next tier and stores as before; with a remainder of 30 s or less, the focused tier follows the tier.

**011 C5**, a paragraph after the re-run paragraph ("A worktree's own new failure is re-run once before it is trusted ..."):

> Amended <date> (the human, row 011-135, gh-64; `tasks/011-135/design.md`, Q4 (a)): a focused run (C15) is not a result. It changes no known state, records no transition, is never a known failure or a replaced one, and is not re-run: the re-run of a new failure applies to the file's own run, which follows unchanged. The daemon keeps the newest focused run of each test file in the `focused:<worktree>` meta row, at most 20 files, the oldest dropped first: the file's key and revision at the run's start, the texts, the run and its log, its end (`completed`, `discarded` with the reason, `crashed`, `timed-out` or `cancelled`), how many checks the runner collected and how many held a text, and each selected check's outcome, duration, summary, location and fingerprint, at most 50 with a count of the rest. An entry applies while its key is the file's current key and the file has no result at that key. No hook, Stop wait or delta reads it.

**011 C6**, a paragraph at the end of the section:

> Amended <date> (the human, row 011-135, gh-64; `tasks/011-135/design.md`): `squeal status` prints, after the earlier-failures line, one line per test file whose focused entry applies (C5), at most three, then `and N more`: `Focused (not counted): <file> at revision N: K of M selected checks FAIL (<names>); its own run is <queued|running>.` `--full` lists the selected checks one per line. A focused run in flight is named in the running-files list with `(focused: <texts>)`, and its file's checks are not counted as running. `--json` adds `focused`, each entry with `applies`; the field is additive. `why <check>` names the check's newest focused run below its known state: `Focused run at revision N (<duration>, log <dir>): <OUTCOME>, not a stored result; the file's own run decides`, then `its key moved since` when the entry no longer applies; `--json` adds `focused`. `squeal failures` lists no focused failure. `status <path>... --check <text>...` without `--wait` reads the focused entries and stored results of the selected checks and requests nothing.

**011 C14**, a sentence after the `RunnerAdapter` list:

> Amended <date> (the human, row 011-135): `RunOptions.checks`, per test file id the texts of a focused run (C15), and `RunnerAdapter.focuses`, the adapter honours them; both are additive. Given texts for a file, the adapter runs only the checks whose full name holds a text, through the runner's own filter, and reports results for those checks only, plus the file-level check when it failed, and reports how many checks the runner collected and how many held a text; its end, completed files and file errors are as for any run. A file without texts runs whole. An adapter without `focuses` is given no focused run. Vitest's filter is 013 V4's, node:test's 003 D5's, pytest's 007 D6's.

**011 C15**, the first paragraph's second and third sentences become:

> It changes only the order in which queued files are taken. It does not change which files run, their keys, or whether a result is current, so the verdict is the same as without promotion (principle 2). A focused request (below) runs part of a test file first, and its outcome is never a result (C5), so the same holds with it (amended <date>, row 011-135).

**011 C15**, a subsection after "What status and the named line say about each file":

> **Focused checks.** Added <date> (the human, row 011-135, gh-64; `tasks/011-135/design.md`, Q1 to Q6 (a)). `squeal status --wait <ms> <path>... --check <text>...` asks the daemon to run first, alone, the checks of each test file selected by its own path whose full name holds one of the texts. The full name is the check's identity within its file (013 V4); the path and project are not matched, and a text that begins with the file's printed prefix (`[project] <path> > `) is read without it. A source path selects no focus, and `--check` with source paths only is a usage error. The CLI sends `focus` (those test files, the texts and the time left of the wait) once, beside `promote`. The daemon keeps a focused entry per file until the deadline, in its memory, and runs it as C4 says. A daemon that does not know the request answers unknown, and the wait says `this daemon (Squeal <version>) runs whole files only; waiting for the file's run` and reads as a named wait. The wait's outcome is `focused` once each such file has a focused outcome at its current key, a result stored at that key, or a focused run that selected no check (`No check of <file> holds "<text>" at revision N (the run collected M checks)`). It prints each selected check's outcome with its first error and location, then `A first run each, not re-run; the file's own run decides`, then the named wait's classes with the file still pending. It exits 1 when a selected check failed, else 3. A file current at its key before any focused run gives the named wait's verdict, with the selected checks named from its result, and exits as today. The file stays promoted until the deadline, so its own run leads the next tier. A slow file gets no focused run (`slow file: focused checks run for fast files only`), nor does a file whose runner lacks `RunnerAdapter.focuses` (`<runner> runs whole files only`). `--json` adds `focused`, and `selection.outcome` reads `focused`; both are additive.

**013 V4**, after the first bullet's sentence on `run(testFiles)`:

> Amended <date> (the human, row 011-135; `011-core/tasks/011-135/design.md`, measured on Vitest 4.1.10 and 5.0.3): a run given texts for a file (011 C14, `RunOptions.checks`) creates that file's specification with `testNamePattern`: each text escaped, each ` > ` in it matching ` > ` or a space, the texts joined by `|`, since Vitest 5 matches the full name joined by ` > ` and Vitest 4 by a space. The pattern is the specification's, never `setGlobalTestNamePattern`'s. Vitest reports each check the pattern leaves out as `skipped`; the adapter reports only the checks whose `fullName` holds a text, and the file-level check only when it failed. `testIds` and `testLines` are not used.

**003 D5** (node:test), a sentence at the end of the first paragraph:

> A focused run (011 C14, row 011-135) adds `--test-name-pattern=<pattern>` before the file, built as 013 V4's. Node 24 does not report a check the pattern leaves out, and reports the file as one passing test when it leaves out every check, so the adapter keeps only the checks whose full name holds a text and reports a file that selected none as matching nothing, never as a pass.

**007 D6** (pytest), a sentence after "Overrides keep the run whole ...":

> A focused run (011 C14, row 011-135) is the one run that is not whole: the adapter sets `SQUEAL_PYTEST_CHECKS` to the texts as JSON, and `squeal_pytest` deselects every collected item whose full name holds none of them, through `pytest_collection_modifyitems` and `pytest_deselected`, so pytest counts them deselected and a file is completed when its selected items tore down. `-k` and node ids are not used.

**`status.md`**, one line:

> - <date>, 011-135 design accepted (the human, `tasks/011-135/design.md`, Q1 to Q6 (a)): C4, C5, C6, C14 and C15 amended, 013 V4, 003 D5 and 007 D6 with them. `status --wait <ms> <test file> --check <text>` runs the file's selected checks first, alone; their outcome lives in the `focused:<worktree>` meta row and is never a result, a known state, a known failure, a duration or a checkpoint; a focused red is not re-run, and the file's own run follows under C5 unchanged; the wait exits 1 on a focused fail, else 3. Code rows R1 to R3 of the design's section 8.

## 8. Code rows

Three rows. R1 lands first, since R2 and R3 call its option. R2 and R3 can then run side by side on disjoint files, since section 2.2 fixes the meta row's shape. Each is a product row, reviewed before main, with its version raise.

| Row | Scope | Owns | Done when |
| --- | --- | --- | --- |
| R1, runner contract | `RunOptions.checks` and `RunnerAdapter.focuses` (additive); the Vitest pattern and post-filter (013 V4); node:test's `--test-name-pattern` (003 D5); the deselection hook in `squeal_pytest` and its variable (007 D6). No scheduler change, so no daemon runs a focused tier yet. | `src/core/types/runner.ts`; `src/runners/vitest/{adapter,reporter,results}.ts`; `src/runners/node-test/run/run.ts` and the report reader; `src/runners/pytest/{adapter-run.ts,run/report.ts,runtime/squeal_pytest.py}`; their tests; the plugin bundles (the Python module is copied into each `dist/pytest/`) | For each runner, with real runner processes, a fixture of four checks (one red, one in a nested suite, one at top level): texts select exactly the matching checks, the others are not reported (no `skip`), the file-level check is reported when the file does not load, and a text that matches nothing reports `matched: 0`, never a pass. Vitest: a text with ` > ` selects on the installed Vitest 5. A file without texts runs and reports as before, with the existing runner tests unchanged. `test/keys/key-format.test.ts` says whether the key format moves; under C3's rule (row 011-37) a filter that whole-file runs never take should not move it (inferred). |
| R2, scheduler and store | The `focus` request (protocol, desk, handler, front desk); the focused entries in the daemon's memory with their deadline; the rank and the focused tier in `selectTier`; the yield as for a promoted file; the record path that stores nothing under a key and writes `focused:<worktree>` at the start and the end; dropping an entry answered by a stored result; the discard and re-queue at the new key; no entry for a slow file or an adapter without `focuses`. | `src/core/types/daemon.ts` (additive request type); `src/core/daemon/{protocol,desk-messages,desk,handlers,front-desk}.ts`; `src/core/types/store.ts` (`WORKTREE_META_ROWS.focused`); `src/core/scheduler/` (a new `focused.ts`, `queue.ts`, `tiers.ts`, `yields.ts`, the record path, `scheduler.ts`); `test/scheduler/focused.test.ts`; a daemon protocol test | `test/scheduler/` with a fake runner of fixed durations: the focused tier leads its lane; a 200 s tier yields to it, a tier with 30 s or less left does not; the focused tier stores no result, known state, transition or duration, and writes the meta row twice; the file's own run leads the next tier and stores, and its new failure is re-run once (C5 unchanged); a result at the current key drops the entry with no run; an input changed during the focused run discards it and queues it again at the new key while the deadline holds; the backlog's turn still comes after four first-group tiers; a slow file gets no entry. One test with real Vitest on `research/probes/issue-64/fixture/` (30 checks of 400 ms): the focused red is in the meta row before the file's own run starts. |
| R3, CLI, status and `why` | `--check` on `status` and `status --wait`; the `focus` request beside `promote`; the `focused` outcome, its text and exit status; the older daemon's fallback; the `Focused (not counted)` line, the running-files mark, `--json` `focused`; the `why` line and `--json`; the help text and the agent-facing skill text that names the wait. | `src/cli/main.ts` (`status`'s options, line 242), `src/cli/status-command.ts`, `src/cli/status-wait-paths.ts`, `src/cli/status-wait-promote.ts`, `src/cli/named-file-lines.ts`, `src/cli/status-wait-lines.ts`; `src/core/status/{snapshot,format-status,why,format-why}.ts` and a new reader of the meta row; the status JSON types (additive); the `squeal` skill files; their tests | `--check` with source paths only is a usage error; a focused fail exits 1 and a focused pass 3, each with the drafted text; a file already current exits as a named wait does; a text that matches nothing returns at once with its line; a daemon that answers the request unknown gives the fallback line and a named wait; `status` prints the line only while an entry applies, and `--json` carries `focused` with `applies`; `why` names the focused run and, after a key move, `its key moved since`; `failures` and the hooks show nothing of it; a text with the printed prefix selects the same checks as without it. |

Not a row now: Q4 (b), a focused red as C5's first run. It would be its own row after the human chooses it, with C5's sentence and a scheduler test that the file's own fail of a focused-red check at the same key is not re-run.

## 9. The done-when, answered

| Done-when question | Answer | Section | Tag |
| --- | --- | --- | --- |
| The selector: a check name or a pattern, on `status --wait <file>` or its own command | A literal `--check <text>`, repeatable, matched against the check's full name within each test file named by its own path, on `status --wait <ms> <path>...`; no regular expression, no new command | 1 | read in source code (today's rules); inferred (the choice) |
| Where focused evidence lives: never a keyed result, never current, never a known failure, never a checkpoint | The `focused:<worktree>` meta row, the newest focused run per test file, at most 20 files and 50 checks each; no `results` or `known_states` row, so none of the four; not a table, since an older Squeal refuses a newer schema | 2.1, 2.2 | read in source code (schema 1, the refusal, the meta rows); inferred (the rules that keep it apart, to be tested in R2) |
| How status and `why` show it | `Focused (not counted): ...` in status while the entry applies, `(focused: <texts>)` on a running file, `--json` `focused`; a `Focused run at revision N ...` line in `why` with `its key moved since`; nothing in `failures`, the hooks or Stop | 2.3 | inferred (a proposal) |
| The runner contract: an additive name filter in C14 and 013 V4, and what node:test and pytest offer | `RunOptions.checks` and `RunnerAdapter.focuses`, both additive. Vitest: a per-specification `testNamePattern`, joined by ` > ` in 5.0.3 and by a space in 4.1.10, every left-out check reported `skipped`. node:test: `--test-name-pattern`, joined by a space, left-out checks not reported, a pattern that selects nothing reports the file as a pass. pytest: a deselection hook in Squeal's plugin; `-k` and node ids exist but do not fit | 3 | measured (`results/filters.txt`); read in source code (`RunOptions`, both Vitest versions' types, the pytest plugin) |
| Whether the re-run of a first-seen fail applies to a focused red | No (Q4 (a)): a focused red is a first run, said so, and never enters C5; the file's own run follows and C5 re-runs its new failure as today. Today a named wait holds through that re-run | 4 | read in source code (the wait holds through the re-run); inferred (the recommendation) |
| Its lane and order beside the file's full run | A focused tier of its own, first in the file's lane; a running tier yields to it as to a promoted file (Vitest, remainder over 30 s, once per file and key); the file stays promoted and leads the next tier; a stored result at the key answers it with no run; slow files excluded | 5 | read in spec (C4 step 5, C15); inferred (the rule) |
| The gain measured on cezarion#1269's parity files at low load | Codex file at load near 16: whole 119.7 s against `-t` 6.4 s and 6.3 s, the same red, 19 times; claude 443.1 s against 8.6 s and 7.8 s, and cursor whole 242.8 s, both under higher load; the daemon's red would fall from about 236 s to about 8 to 19 s after the edit. Four files, the warm-instance runs and the green were not taken (load above 16 from 07:59Z to 09:21Z) | 6 | measured (the runs); inferred (the daemon model) |
| Amendments drafted for C4, C5, C6, C14, C15 and 013 V4 | Section 7, with 003 D5, 007 D6 and the `status.md` line | 7 | inferred (drafts) |
| The code rows it implies | R1 runner contract, R2 scheduler and store, R3 CLI and status; Q4 (b) only on the human's choice | 8 | inferred |

## Limits and open questions

- **The 387 s of cezarion#1269 is still not replayed.** Section 6 measures each parity file alone, not the incident's queue, tier mates or claims.
- **Older Node versions** were not checked for `--test-name-pattern`'s match against ancestors' names. A miss there selects nothing, which the wait says.
- **Vitest 4** is below Squeal's peer range (`vitest >= 5`, read in `package.json`), yet cezarion runs 4.1.10 under Squeal today. The pattern covers both joins.
- **Two focused requests on one file with different texts** while one runs: the second queues a new entry, and the newest run replaces the row's entry. Not measured.
- **A focused run of several files** (all six runner parity files at once, one tier of up to `runner.tierSize`) was not measured.
- **Shared state between checks.** A check that passes only after an earlier check in its file ran may fail alone. The focused output then disagrees with the file's own run, which decides. Squeal cannot tell the two apart. *Inferred.*
