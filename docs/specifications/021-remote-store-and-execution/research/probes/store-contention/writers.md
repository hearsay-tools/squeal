# Store writers in source (Q2), throwaway collation

Read at `0fa197e09` by a sub-agent of researcher a1540808; spot-checked against `src/core/store/{open,connection,busy}.ts`, `src/cli/{hold,stopped-mark,store-writes}.ts`, `src/core/daemon/open.ts`, `src/core/delivery/{held-connection,prepared,code-source}.ts`, `src/harness/shared/hand-off.ts`, `src/core/daemon/lifecycle.ts`. Paths are under `src/`.

## Callers of `openStore`

Named values: default 1,000 ms (`core/store/open.ts:46`), `STATUS_BUSY_TIMEOUT_MS` 1,000 (`core/status/open.ts:11`), `CLI_SOCKET_TIMEOUT_MS` 2,000 (`cli/daemon-access.ts:9`), `DAEMON_BUSY_TIMEOUT_MS` 5,000 (`core/daemon/open.ts:44`), `DAEMON_START_BUSY_TIMEOUT_MS` 120,000 (`core/daemon/open.ts:54`).

| Site | Process | Writes? | Busy ms | Busy retried? |
|---|---|---|---|---|
| `cli/hold.ts:252` | `squeal hold` | hold rows (`meta`) | 1,000 | No; the error becomes a message and the command still runs (`:260-262`) |
| `cli/stopped-mark.ts:68` | `squeal stop` mark, `squeal start` clear | one `meta` row | 2,000 (`:12`) | No |
| `cli/start.ts:266` | `squeal start` handoff claim | yes | 1,000 | No (catch → true) |
| `cli/store-writes.ts:28` | `retry`, named `status --wait` asks | yes | 2,000 per try | `whileBusy`, 10 s bound, backoff 0/100/250 ms (`:20,51-66`) |
| `cli/import.ts:104` | `squeal import` | a bundle | 2,000 per try | `whileBusy`, 10 s |
| `harness/shared/context.ts:95` | every hook process (Claude Code, Codex; Pi worker, OpenCode bridge) | deliveries, consumers, the held transaction | 1,000 | No; busy makes the hook silent (`core/delivery/held-connection.ts:120-127`) |
| `core/daemon/open.ts:227` | daemon start (quick_check, WAL switch, migration, register, baseline) | yes | 120,000, then 5,000 once serving (`core/daemon/daemon.ts:852-854`) | WAL switch loops; open retried if the file changes |
| `core/status/open.ts:106` | `status`, `why`, `failures`, `code`, `lint`, waits | no (one read transaction) | 1,000 | reopen loop to `busyRetryMs` (CLI 5,000) |
| `cli/{remove,run-lanes,stop-removed,wait-liveness}.ts`, `core/daemon/ensure.ts:133` | CLI reads | no | 100 to 2,000 | No |
| `cli/ci-export.ts:78`, `core/code/gate/stored.ts:236` | scratch stores only | — | — | — |
| `core/daemon/notes.ts:34-48` (not `openStore`) | note into a newer store | one `meta` row | 2,000 | No |

## Daemon: sliced and retried, or not

Through a 250 ms slice with retry (`core/store/busy.ts`, `core/store/connection.ts:99-110`): change-feed batches (`core/scheduler/scheduler.ts:393-415`, `core/daemon-loop/index.ts:139-160`), tier records (`record.ts:138-160`), tier selection and `#requeue` (`scheduler.ts:1138,1616-1647`), heartbeat, harness and leaving checks, consumer expiry, prune and code prune (`core/daemon/sliced-writes.ts:61-66`, `core/daemon/lifecycle.ts:382-430`), full-check claim, coverage writer (on `code.sqlite`).

At the full 5 s, not retried: socket requests (`scheduler.ts:650,689,762,787,809`), `#reconcilePaths` ("No slice", `:1649-1654`), `refreshInstall` (`:1122`), `#queueRewalk` (`:1047`), `#updateCommit` (`:1272`), refinement apply (`runner-work.ts:248-268`), CI import by the shared reader (`shared/reader.ts:211-219`), `#register` (`daemon.ts:443`), baseline (`scheduler.ts:293`, under 120 s), shutdown (`scheduler.ts:1021`, `daemon.ts:1152-1159`).

## Long write transactions

No transaction spans an `await` or a subprocess, except the hook hold.

- Tier record (`record.ts:344-376` → `tiers.ts:858-864`): `runs.finish`, then results, failure texts and states of every file of the tier, then `ledger.commit`. 11 to 67 s for 198 files on cezar's store in 001-161 (`core/daemon/open.ts:47-53`).
- Revision apply (`core/scheduler/batch.ts:62-85`): revision row, `file_hashes`, `rekeyContent`, `ledger.commit`.
- Ledger commit (`ledger.ts:710-755`); at baseline it covers every test file and inherited state (`bootstrap.ts:283,300-316`).
- CI import (`core/store/transfer-import.ts:84-114`): one transaction per bundle, unsliced in the daemon.
- Prune (`core/store/prune.ts`): `worktrees.remove` one unbatched transaction over 7 tables plus `meta` (`repos/worktrees.ts:169-179`); results in batches of 256 (`prune.ts:19,173-190`); `dropRuns` unbatched (`:152-165`); checkpoints and `checks` one full-scan transaction each (`:117-134`).
- **Hook hold** (row 011-288, 0.1.386): `HoldingConnection.hold` opens `BEGIN IMMEDIATE` (`core/delivery/held-connection.ts:72-102`, `core/delivery/prepared.ts:133-134`) and keeps it open across the rest of the async hook and the output write, ended at most `HAND_OFF_BOUND_MS` = `HOOK_TIMEOUT_MS` = 2,000 ms later (`harness/shared/hand-off.ts`, `core/types/store-records.ts:306`). A code-store hold may open inside it (`core/delivery/code-source.ts:108-130`).

## WAL and checkpoints

Set: `journal_mode=WAL` (`core/store/open.ts:183`), `synchronous=NORMAL` (`:156`), `auto_vacuum=INCREMENTAL` on new files (`:154`); `incremental_vacuum(512)` in steps (`core/store/prune.ts:197-205`). Not set anywhere in `src/`: `wal_autocheckpoint`, `wal_checkpoint`, `journal_size_limit`, `optimize`, `mmap_size`, `cache_size`, `temp_store`.

## Tables

Per worktree: `WORKTREE_SCOPED_TABLES` = `revisions`, `file_hashes`, `test_file_keys`, `known_states`, `transitions`, `consumers`, `consumer_views` (`core/store/repos/worktrees.ts:19-27`); also `runs`, `checkpoints`, `worktree_environment_hashes`, `worktrees`. Shared: `test_files`, `checks`, `failure_texts`, `results` (primary key check and key; `worktree_id` is provenance, `core/store/schema.ts:99-121`), `environments`, `test_file_imports`, `environment_walks`, `imports`, `import_files`. `meta` is mixed (`worktreeMetaKey`, `core/types/store.ts:433`).

## Other files and locks

`code.sqlite` (`core/code/store/open.ts`) and `lint.sqlite` (`core/lint/store/open.ts`) are separate files, created only while their feature is on, so their schema versions move apart from the main store's (`docs/specifications/015-coverage-complexity/spec.md:120`, `017-lint-checks/spec.md:138`). Each has its own write lock. `locks/<worktree>.sqlite` (daemon singleton), `locks/waiter-<id>.sqlite`, `locks/store-recovery.sqlite` guard processes, not `store.sqlite`'s writes.
