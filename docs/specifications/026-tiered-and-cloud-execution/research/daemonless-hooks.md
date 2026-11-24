# daemonless-hooks: complexity and lint without a long-lived daemon

Researcher task 7652fba7 for spec 026, 2026-11-23 23:40Z to 2026-11-24 00:55Z. Brief: `README.md`, "Topic: daemonless-hooks". Source read at `d57b32d0f` (Squeal 0.1.611); every probe ran this worktree's committed plugin build (0.1.611) or a bundle of its sources made the same way. Tools: Node v26.13.0, oxlint 1.90.0, ESLint 10.13.0, Biome as installed here. Host: 16 CPUs visible to these processes (`nproc`), shared with other coordinators. Timings were kept only from rounds that started at one-minute load 24 or below; the load range is given beside each table. Probes: `probes/daemonless-hooks/` (throwaway, README there). Extends `tiered-pre-pr.md` and `../../021-remote-store-and-execution/research/daemon-heap.md`; neither is repeated.

**Verdict.** Complexity and oxlint need nothing from a daemon that a short-lived process cannot do: their results, states, transitions and the sessions' views already live in `code.sqlite` and `lint.sqlite`, keyed by content, and the hooks already read them without the daemon. What only the daemon has is the list of changed files (its watcher and revisions) and warm tools. Running the work inline in PostToolBatch (A) costs 140 to 630 ms per edit batch at the median, over the 200 ms warn limit, and cannot carry ESLint. A fire-and-exit helper (B) keeps today's hook latency and holds no memory between edits. Today's daemon with no runner host (C) idles at 270 to 340 MB RSS per worktree plus 138 MB per clone and 2% of a core. **Recommendation: (C) first, then (B) built from today's daemon rather than new code. (C) is moment-aware keying, so no runner host starts (as `tiered-pre-pr.md` proposed). (B) is a short `daemon.unusedExitMinutes` for policies with no test group at `edit`; in the one probe run the short exit did not fire, so (B) is not proven yet. Inline (A) is rejected.**

## Questions answered

| # | Question | Answer | Tag |
|---|---|---|---|
| 1 | What complexity and lint need from the daemon | Stored, content-keyed and shareable: counts, lint results, states, transitions, views, told marks. Daemon-only: the watcher, revisions and file hashes the passes read their changed paths from, warm tree-sitter and ESLint, the code store's write relay, commit-report refresh. With no daemon, `status`, `squeal code` and `squeal lint` still answer from the stores, but nothing new is counted or linted | read in source code |
| 2 | Inline hook latency | Node 60/80 ms (p50/p95); today's hook bundle with no work 90/170 ms. Counting 1, 3, 5 files 140/220, 170/290, 200/310 ms, of which WASM load and the first file about 55 ms. SQLite write +5 to 15 ms. oxlint through Squeal's provider 500 to 510 / 570 to 730 ms (three oxlint processes); one raw oxlint process 70 to 80 / 100 to 110 ms. Both through the provider 580 to 630 / 740 to 880 ms. ESLint, one file, core rules 280/370 ms | verified by experiment (load 20 to 26) |
| 3 | Daemon RSS with no runner host | 267 to 343 MB RSS (204 to 280 MB private) per worktree when settled, plus the clone's store process 137 to 139 MB (79 to 81 private). Peak 603 MB during the first whole-worktree pass. Today the same policy adds a Vitest keying host of 487 to 683 MB | verified by experiment |
| 4 | (A), (B), (C) compared | See the table in Q4. (B) is the only one with today's hook latency and zero idle memory; (C) is the smallest change; (A) is over the warn limit on every edit batch | verified by experiment; inferred |
| 5 | Recommendation | (C) first, then (B) as a short-lived daemon. Not (A). The short exit did not fire in the one probe run, so (B) is not proven | inferred from the measurements; the exit verified by experiment |

## Q1. What complexity and lint need from the daemon today

All `read in source code` at `d57b32d0f`.

- **Trigger.** The watcher alone. `afterBatch` calls `code.nudge()` and `lint()` after each debounced batch (100 ms quiet, 500 ms max; `src/core/daemon/daemon.ts:1130-1134`, `src/core/watcher/change-feed.ts:92`), and once at start (`daemon.ts:1159-1161`). Hooks never nudge a pass; they pass no edited paths to the daemon (`src/harness/claude-code/input.ts:24-25`). A HEAD move seen by a hook asks the daemon for a `sync` (`src/core/commit/boundary.ts:60-82`).
- **Results.** `code.sqlite` and `lint.sqlite` beside the store, one per clone. `counts` are keyed `(blob, language, counter_version)` and lint `results` by `(check_id, key)` over the file's blob, config closure and tool versions; both are "shared by every worktree" (`src/core/code/store/schema.ts:12-42`, `src/core/lint/store/schema.ts:13-46`, `src/core/lint/pass/keys.ts`). Count keys are git blob ids (`countFile`, `src/core/code/count/index.ts:29-40`).
- **Transitions.** The "before" side is in store tables, not memory: code compares with `store.states.list` and appends transitions in one transaction (`src/core/code/pass/edit.ts:88-108`); lint reads `judged_*` columns and the prior result (`src/core/lint/pass/judge.ts:151-166`, `src/core/lint/transition.ts:18-33`). Per-session views and told marks are written by the hook process itself (`src/core/delivery/code-deliver.ts:369-374`, `src/core/lint/surface/deliver.ts:230-238`).
- **What the hook reads.** PostToolBatch opens both stores read-side and delivers from them (`src/harness/shared/deliver.ts:79`, `context.ts:138-153`). It never waits for a pass, except the HEAD-move sync.
- **Daemon memory only.** The code pass's retry set and CRAP `StepCache`; the lint pass's `feed` set and provider session (`src/core/code/pass/index.ts:99-127`, `src/core/lint/pass/index.ts:48-53`). None is needed for correctness: a retry is a later recount, and a new provider reads every config again.
- **What breaks with no daemon.** (1) Change detection: the passes read changed paths and blobs from the main store's revisions and stat cache (`src/core/code/pass/source.ts:11-53`), which only the scheduler writes (`src/core/revision/reconcile.ts:202`). (2) External edits: only the watcher and its 30 to 300 s reconcile see a `git pull` or a human's edit. (3) Warm tools: tree-sitter loads once per process; the ESLint worker thread is kept warm per root (`src/core/lint/provider/eslint-provider.ts:198-200`); oxlint is a fresh process per run anyway (`src/core/lint/provider/oxlint/spawn.ts`). (4) Commit reports: refreshed by the scheduler when lint records (`src/core/scheduler/scheduler.ts:893-896`). (5) The code store's writes go to the clone's store process through the daemon's relay (`src/core/store-process/relay.ts:19-30`); a direct connection is the older path.
- **Hook input.** PostToolBatch carries `tool_calls[]` with each `tool_input` (`../../001-core-loop/research/pull-advances-push.md` section 3, verified there). Edit and Write paths are therefore known to a hook; a Bash edit, a code generator or a `git pull` is not.

## Q2. Inline hook latency

`drive.mjs`, 15 rounds, each case once per round; load 20.1 to 26.4 (one round crossed 24 after it started). Fixture: a shallow clone of this repository (18,353 tracked files) with oxlint's `typescript`, `unicorn` and `oxc` plugins, correctness rules. `inline.ts` uses Squeal's own counter, code store and oxlint provider. Wall and CPU from GNU `time` (10 ms resolution); phases from `performance.now()`. `verified by experiment`.

| Case | Wall p50 / p95 ms | CPU p50 ms | Max RSS MB |
|---|---|---|---|
| `node -e 0` | 60 / 80 | 60 | 60 |
| Today's `post-tool-batch.mjs`, no config, no work | 90 / 170 | 90 | 64 |
| Count 1 / 3 / 5 files | 140 / 220; 170 / 290; 200 / 310 | 210; 250; 350 | 95 |
| Count, then write `code.sqlite`, 1 / 3 / 5 | 150 / 210; 160 / 230; 210 / 450 | 220; 260; 340 | 96 |
| oxlint provider (`--print-config`, `--debug files`, lint), 1 / 3 / 5 | 510 / 710; 500 / 570; 510 / 730 | 500 to 510 | 89 to 91 |
| One raw `oxlint --format json --threads 1`, 1 / 3 / 5 | 70 / 100; 80 / 110; 80 / 110 | 70 to 80 | 88 to 91 |
| Count + SQLite + oxlint provider, 1 / 3 / 5 | 580 / 820; 580 / 740; 630 / 880 | 680 to 780 | 96 |
| ESLint 10 CLI, 1 file, 3 core rules | 280 / 370 | 310 | 96 |
| `biome lint`, 1 file | 130 / 220 | 110 | 61 |
| `git status --porcelain=v2` | 60 / 720 (first run 720, then 40 to 100) | 90 | 10 |
| `git diff --name-only HEAD` | 20 / 30 | 50 | 11 |
| A hook that spawns a detached helper and exits | 60 / 80 | 60 | 60 |

Phase medians (ms since process start): the bundle is loaded at 62 to 66. The first count, including web-tree-sitter's runtime, the Python and TSX grammars, ends at 118 to 136: about 55 ms. Each further file costs 6 to 17 ms (`daemon.ts`, 1,595 lines, included). Opening `code.sqlite` and one write transaction: 3 to 13 ms on a fresh store. The provider's `open` (`--print-config` with the preload) takes 250 ms; `--debug files` 80 to 90 ms; the lint itself 90 to 100 ms. One raw oxlint process stays at 70 to 80 ms from 1 to 5 files, so the provider's two extra processes, not the linting, are four-fifths of its cost.

**Against the limits** (`bench/README.md`: PostToolBatch p95 80 ms healthy, 200 ms warn, 2,000 ms timeout). Node alone is 60 to 80 ms, and today's hook already measures 98 to 134 ms on a fixture (`tiered-pre-pr.md` Q1) and 117 to 221 ms here (Q4). An inline count adds about 55 ms plus 10 ms per file. An inline oxlint adds 80 ms with one process, or 430 ms with today's provider. So an inline (A) hook on an edit batch would be about 250 to 350 ms at p50 with one oxlint process and 650 to 900 ms with today's provider: over the warn limit at every edit batch, under the timeout. ESLint fits only without typed rules: cold it costs 280 to 370 ms here and 420 ms of CPU in 016's measurement (`../../017-lint-checks/spec.md`); a cold typed lint of one Svelte file took 6.8 to 7.3 s (`../../017-lint-checks/lessons.md`), over the 2 s timeout. `inferred` from the rows above.

## Q3. What a daemon holds with no runner host

`mem.sh` and `slim.sh`: a shallow clone of this repository at `d57b32d0f`, every test group at `manual`, oxlint at `edit`, complexity on, a fresh store, default `runner.hostIdleMinutes`. Variant `norunner` has a `node_modules` with oxlint only, so neither a runner host nor a test closure can load: the state moment-aware keying aims at. Variant `today` has the full `node_modules`. RSS and private memory from `/proc/<pid>/status` and `smaps_rollup`. `verified by experiment`.

| State (load) | `norunner` daemon | `today` daemon | `today` Vitest host | Store process |
|---|---|---|---|---|
| Just started (21 to 27) | 144 RSS, 85 private | 151, 91 | not yet | not yet |
| First pass, 60 s (26 to 30) | 603, 541 | 579, 516 | 683, 613 | 118 to 177 |
| Settled, CPU flat 30 s (21) | 274, 212 | not reached in 3 min | | 138, 80 |
| After 5 edits (20) | 343, 280 | | | 138, 80 |
| 90 s after one edit (20 to 33) | 295, 233 | 399, 336 (still busy) | 487, 417 | 137 to 139 |

- **The first pass is the peak.** On a fresh store, the `norunner` daemon counted 4,470 files and linted 6,596 with 122 s of CPU (children included), at up to 603 MB RSS. In a clone whose store already holds those counts and results, a new worktree adopts them by key, as 015 goal 8 states; not measured here.
- **What fills the 270 to 340 MB.** Node and the 5 MB CLI bundle: 91 MB RSS (`squeal --version`). web-tree-sitter and its grammars: about 30 MB (count-1 against probe-none, Q2; 32 MiB in `daemon-heap.md`). The rest, about 150 to 220 MB, is heap and native memory left by the first pass and the lint pass; not broken down further. The `today` daemon is larger by the test closures, 150 to 156 MiB live on Squeal (`daemon-heap.md` Q1).
- **Live host, 2026-11-24 00:55Z (read only):** 10 daemons of Squeal and cezar worktrees 343 to 1,271 MB RSS (6.3 GB in all), 10 Vitest hosts 448 to 1,687 MB (7.6 GB), 6 node:test hosts 100 to 127 MB, 2 store processes 168 and 219 MB: 14.9 GB for 10 worktrees.

## Q4. Three architectures

Hook latencies of (C) are `slim.sh` (5 edits, load 19 to 20). CPU of (C) is the probe processes' CPU over each 15 s edit window, children included; idle CPU was 1.3 s per 60 s, so about 0.3 s of each window is idle cost. (A) and (B) per-edit CPU is the Q2 `both` row.

| | (A) Inline in PostToolBatch | (B) Fire-and-exit helper | (C) Slim daemon, moment-aware keying |
|---|---|---|---|
| PostToolBatch, edit batch | 250 to 350 ms p50 with one oxlint process; 650 to 900 ms with today's provider (inferred, Q2) | Today's hook plus a detached spawn: about 0 ms more (a spawning hook is 60 / 80 ms, the same as Node's floor) | 117 to 221 ms (measured; first edit 221, then 117 to 163) |
| When results arrive | In the same hook | The first hook after the helper ends: 0.6 to 0.9 s of work (Q2) | The first hook after the pass ends; in the probe, the hook 1 s after the edit |
| Idle RAM, 1 worktree | 0 | 0 | 274 to 343 MB + 138 MB store process per clone |
| Idle RAM, 12 worktrees of one clone | 0 | 0 | 3.4 to 4.3 GB RSS (inferred: 12 × 274 to 343 + 138) |
| CPU per edit batch | 0.2 to 0.8 s (count 0.2 to 0.35 s, provider oxlint 0.5 s) | The same as (A), plus change detection | 0.4 to 0.7 s per 15 s window, of which about 0.3 s idle cost |
| Idle CPU | 0 | 0 | 2.2% of one core per worktree |
| External edits (git pull, a human's edit, Bash) | Seen only at the next edit hook, and only if it scans: `git diff --name-only HEAD` 20 / 30 ms, `git status` 60 / 720 ms | The same | The watcher, within 0.1 to 0.5 s, or the 30 to 300 s reconcile |
| ESLint | Untyped only: 280 to 420 ms cold per hook; typed 6.8 to 7.3 s, over the timeout | Works, cold each run: 0.3 to 7 s of CPU per edit | Warm worker: 48 to 51 ms CPU per edit (017 spec) |
| `squeal status`, `code`, `lint` | Answer from the stores; they hold the last hook's results | The same, the last helper's | As today |
| Commit reports | Not refreshed: the scheduler makes them | Not refreshed unless the helper does it | As today |
| Implementation scope | Large: a new change source in the hook (no revisions), a time budget that drops work, no ESLint, no repo-wide first count | Medium as a new process; small as today's daemon with a short unused exit (Q5) | Small: `tiered-pre-pr.md` recommendation 2 |

## Q5. Recommendation for Squeal

1. **Do not run checks inline in the hook (A).** At the median it puts every edit batch over the 200 ms warn limit (250 to 900 ms against today's 98 to 221 ms), it has no answer for typed ESLint, and it cannot do the whole-worktree first count. Its one gain is results in the same hook. Today's daemon gives that only when its pass ends before PostToolBatch runs: the watcher waits 100 ms of quiet before a pass, and PostToolBatch fires about 17 ms after the batch's last PostToolUse (`../../001-core-loop/research/pull-advances-push.md` section 3). In `slim.sh`, with the hook 1 s after each edit, the lint FAIL came in that hook (`verified by experiment`). 015 D5 says counts arrive "usually [at] the hook of the edit that made them". How often that holds in real sessions is not determined here: it needs hook and pass times from session logs.
2. **Make keying moment-aware first (C).** It is required by every option: while a runner host starts on every edit (`tiered-pre-pr.md` Q1), no design holds less than 0.5 to 1.1 GB per worktree. With it, a worktree with no test group at `edit` holds 274 to 343 MB plus 138 MB per clone, and 2% of a core.
3. **Then make the daemon short-lived for such policies (B), rather than writing a new helper.** Squeal already stops a daemon that saw no use for `daemon.unusedExitMinutes` (default 30) and restarts it at the next hook (`src/core/daemon/lifecycle.ts:250-258`, `src/harness/shared/ensure.ts:129-138`). With no test group at `edit`, a default of one or two minutes gives (B)'s profile: today's hook latency, zero memory between bursts of edits, and every piece of today's pass (revisions, watcher during the burst, transitions, the store-process relay, ESLint warm within the burst). This did not work in the one probe run (`restart.sh`, `restart-norunner.log`): a `norunner` daemon with `daemon.unusedExitMinutes` 0.5, one SessionStart consumer and no edits stayed up for 20 min after its first pass, at 289 MB RSS, and wrote nothing to its log. Why it did not stop is not determined; the probe was stopped there. So the restart's cost per burst is not measured. A daemon start in `mem.sh` reached its first `status --wait` answer in 200 to 217 ms and used 1.0 to 1.2 s of CPU, its start scan of 18,353 files included. A row for (B) must first find out why the unused exit did not fire, then measure the restart's CPU against (C)'s 2% of a core at idle.
4. **Cut the oxlint provider to one process per pass where it can** (`--print-config` keyed by the config blobs, `--debug files` only when oxlint counts fewer files than named, as it already does in `lint`). That takes 330 to 430 ms of the 500 ms per run. It helps (B) and (C) alike.

## Open questions for the human

1. Is a result that arrives at the next hook acceptable as the only delivery point when no test group is at `edit`? It is today's behaviour, but with a short-lived daemon an edit after a quiet spell also pays the restart (Q5 item 3).
2. With a short-lived daemon, a `git pull` or a human's edit between bursts is seen only at the next hook's start scan. Is that acceptable, or should a worktree with an open session keep a watcher?
3. Why a daemon with `unusedExitMinutes` 0.5 and an idle consumer did not stop in 20 min (Q5 item 3). Not determined; it decides whether (B) needs new code.
4. Should `squeal status` with no daemon running say how old its complexity and lint answers are (the last pass's revision against the files on disk)? Not determined: what it prints today with no daemon after edits was not tested.

## Sources

- This repository at `d57b32d0f`: `src/core/daemon/daemon.ts`, `lifecycle.ts`, `ensure.ts`; `src/core/watcher/change-feed.ts`; `src/core/code/count/{index,parser,wasm}.ts`; `src/core/code/pass/{source,edit,index,judge,included}.ts`; `src/core/code/store/{open,store,schema}.ts`; `src/core/lint/pass/{index,judge,keys}.ts`; `src/core/lint/transition.ts`; `src/core/lint/store/schema.ts`; `src/core/lint/provider/oxlint/{provider,run,spawn,config-set}.ts`; `src/core/lint/provider/eslint-provider.ts`; `src/core/delivery/{code-deliver,code-source,sent-store}.ts`; `src/core/lint/surface/deliver.ts`; `src/core/store-process/relay.ts`; `src/core/scheduler/scheduler.ts`; `src/harness/shared/{deliver,context,ensure}.ts`; `src/harness/claude-code/input.ts`; `src/core/types/policy.ts` (defaults).
- Research and specs: `tiered-pre-pr.md` (Q1, recommendation 2); `../../021-remote-store-and-execution/research/daemon-heap.md` (Q1), `daemon-model.md`; `../../015-coverage-complexity/spec.md` (D1, D4, goal 8); `../../017-lint-checks/spec.md` (Context, D3, Cost), `lessons.md`, `research/oxlint-provider.md` (Q3); `../../001-core-loop/research/pull-advances-push.md` (section 3); `bench/README.md` (hook limits).
- Probes and outputs: `probes/daemonless-hooks/` (`drive-summary.txt`, `drive-extra-summary.txt`, `mem-today.log`, `mem-norunner.log`, `slim-norunner.log`, `restart-norunner.log`).
