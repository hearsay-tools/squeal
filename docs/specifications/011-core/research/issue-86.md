# Issue 86: `retry` fails on a transient store write lock

Researcher findings, 2026-10-23, at main `78d42b7db` (0.1.279). Documentation only: no design, no implementation. Existing holds stand.

## Verdict

**Reproduced synthetically. The original incident is not independently reproduced.** On an isolated synthetic store, `askRetry` with the `retry` CLI's busy timeout (2,000 ms) threw `ERR_SQLITE_ERROR`, errcode 5, "database is locked", from `BEGIN IMMEDIATE` in `Connection.transaction`, 2,006 ms after it began, while another process held the write lock for 4,000 ms. That is the incident's error, code and stack frame. The next attempt, after the lock was freed, queued the request in 4 ms. A hold of 800 ms, shorter than the timeout, queued the request after 807 ms. The failed attempt wrote nothing, so the next attempt queued exactly one request. A repeat in the same session returned `spent` and wrote nothing.

The CLI has one wait (2 s) and no retry. Nothing between `askRetry` and the process exit catches the error, so a lock held longer than 2 s gives an uncaught stack trace and exit 1. What held the live store's lock for more than 2 s in the incident is not determined.

## Questions answered

| # | Question | Answer | Tag |
| --- | --- | --- | --- |
| 1 | Where does the error come from? | `retryCommand` opens the store with `busyTimeoutMs: CLI_SOCKET_TIMEOUT_MS` (2,000 ms, `src/cli/retry.ts:85`, `src/cli/daemon-access.ts:8`); `askRetry` runs one `store.transaction` (`src/core/retry/records.ts:128`); `Connection.transaction` runs `BEGIN IMMEDIATE` (`src/core/store/connection.ts:47`). A lock held past 2 s makes `BEGIN IMMEDIATE` fail with SQLITE_BUSY | read in source code (0.1.279); verified by experiment (0.1.279) |
| 2 | Does a lock held past the busy timeout reproduce the reported error? | Yes: `code=ERR_SQLITE_ERROR errcode=5 errstr=database is locked`, frames `connection.ts:47` in `Connection.#withinSlice` and `Connection.transaction`, after 2,006 ms | verified by experiment (0.1.279) |
| 3 | Does a lock shorter than 2 s fail? | No: an 800 ms hold queued after 807 ms. Only a hold longer than 2 s fails | verified by experiment (0.1.279) |
| 4 | Is the failure bounded? | Yes, at the 2 s busy timeout (2,006 ms measured). It is not handled: `main` does not catch a command's error (`src/cli/main.ts`, `retry: retryCommand`), so the process exits 1 with a stack trace | verified by experiment (bound); read in source code (no catch) |
| 5 | Can a failed attempt leave a partial request? | No: `BEGIN IMMEDIATE` fails before any read or write in the transaction. After the failure the record count was unchanged (1, the earlier request) | verified by experiment (0.1.279) |
| 6 | Can repeating the request duplicate it? | Not for one file: the duplicate guard runs inside the same transaction. `askRetry` returns `spent` for the same session at the same key; `askNoResultRun` returns `joined` while one is pending. The empty session `""` matches itself, so it is guarded too. A retry of the whole transaction re-reads the records, so a bounded retry around it keeps one request | verified by experiment (`spent`, 0.1.279); read in source code (`joined`, `records.ts:156`) |
| 7 | Is there a case where a repeat is misleading? | Yes, for several paths in one command. `retryCommand` loops over the paths and commits each file's request separately; a busy error on the second file throws after the first committed, so the first file's line is never printed and `tellDaemon` never runs. A repeat then says "Not retried: ... was already retried in this session ... The failure stands." for the first file and exits 1 | inferred from source (`src/cli/retry.ts:96-118`, `:230`, `:271`); not run |
| 8 | What held the live store's lock for more than 2 s on 2026-10-23? | Not determined, because the issue gives no daemon notes, load or store size, and the brief forbids probing the shared live store. 011 C7 names past long holders (prune 15 s, tier records 11 to 67 s), both since cut into short transactions | not determined |
| 9 | Did code on this path change between 0.1.278 and 0.1.279? | No. `git diff --stat squeal--v0.1.278 HEAD -- src/core/store src/cli/retry.ts src/core/retry src/cli/daemon-access.ts` lists only `src/core/store/repos/results.ts` (+15) | read in source code |

## Evidence

**Reported incident** (issue report, not independently verified). hearsay-tools/squeal#86, Squeal 0.1.278, 2026-10-23, during hearsay-tools/cezarion#1549, several worktrees on one store. `squeal retry packages/web/e2e/session-footer.e2e.ts --reason load` exited 1 with `ERR_SQLITE_ERROR`, errcode 5, from `BEGIN IMMEDIATE` in `Connection.transaction`, called by `askRetry` and `retryCommand`. The next invocation printed `Retry queued (reason: load)`. No daemon crash was seen. Load and the lock holder were not recorded.

**Synthetic probe** (verified by experiment, 0.1.279 source at `78d42b7db` through `tsx`, Node v24.21.0). Host 24 CPUs. One-minute load at the first try: 27.11, above the CPU count, so the probe skipped itself (`SKIP: load above CPU count`). A wait loop rechecked every 10 s and ran the probe at load 22.19 (2026-10-23T21:48:38+02:00).

Command, from the worktree root: `timeout 120 npx tsx docs/specifications/011-core/research/probes/issue-86/probe.ts`. The probe creates a fresh store under `mkdtemp(/tmp/i86-*)`, takes the write lock in a child process (`holder.mjs`: `BEGIN IMMEDIATE`, hold, `COMMIT`), calls `askRetry` with the CLI's 2,000 ms busy timeout and deletes the directory. It never opens the live store. Full output: `probes/issue-86/output-run1.txt`.

| Step | Lock held | Session | Outcome | Records after |
| --- | --- | --- | --- | --- |
| A | 800 ms | s1 | queued after 807 ms | 1 |
| B | 4,000 ms | s2 | THROW after 2,006 ms: `ERR_SQLITE_ERROR`, errcode 5, "database is locked", at `BEGIN IMMEDIATE` | 1 (nothing written) |
| C | none (B's holder freed) | s2 | queued after 4 ms | 2 |
| D | none | s2 | `spent`, nothing written | 2 |
| E1, E2 | none | `""` | queued, then `spent` | 3, 3 |

B then C is the incident's sequence: a refused first attempt, then a queued request.

**Not run.** The `squeal retry` binary end to end (no build, as the brief says), a multi-path command (question 7), and any live store or daemon.

## Recommendation for Squeal

The defect is real and small: the `retry` CLI's write has one 2 s wait, no retry and no catch. The facts a fix depends on:

- A bounded retry around the whole `askRetry` or `askNoResultRun` transaction is safe for duplicates: a failed `BEGIN IMMEDIATE` writes nothing, and the transaction re-reads the records and its `spent` or `joined` guard on each try (questions 5 and 6).
- A persistent lock needs an actionable message and a non-zero exit instead of the stack trace (question 4). 011-01 decided the read side's wording (status.md, 2026-10-17): say how long it waited, that another process holds the lock, and to run the command again.
- A multi-path command needs each file's committed answer reported, and the daemon told, even when a later file fails (question 7). Otherwise a repeat reads as "already retried ... The failure stands." for a request that is in fact queued.

The bound itself (2 s now) is a spec decision; this file names no value.

## Open questions

- What holds a shared store's write lock past 2 s under several worktrees now. The daemons' `daemon:store-busy` notes on an affected host would show it; this brief allowed no live read.
- Whether a request whose daemon was never told (question 7) is claimed later without a tell. Not checked.

## Sources

- hearsay-tools/squeal#86: https://github.com/hearsay-tools/squeal/issues/86 (read 2026-10-23).
- `src/cli/retry.ts`, `src/cli/daemon-access.ts`, `src/cli/main.ts`, `src/core/retry/records.ts`, `src/core/store/connection.ts`, `src/core/store/open.ts` at `78d42b7db`; tag `squeal--v0.1.278` for the diff.
- `docs/specifications/011-core/spec.md` C7 (busy timeouts, past long holders) and C13 ("Store busy past a write's wait"); `status.md` 2026-10-17 (011-01).
- Probe: `docs/specifications/011-core/research/probes/issue-86/` (`probe.ts`, `holder.mjs`, `output-run1.txt`, `README.md`).
