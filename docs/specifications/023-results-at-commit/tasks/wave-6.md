# Wave 6: `squeal status --at` (023-06) and CI's published results at a commit (023-17), in parallel

Read `../spec.md` D1, D2 (amended: no fast path), D3; `../status.md`; `tasks/023-16-notes.md` (the `keysAtCommit` API and its cost: 50 s for all 1,919 test files here, ~6 s for one). The two rows touch disjoint files; the contract between them is `KeyAt.stored`, a list of stored results, each with its origin. No version raise, no `pnpm run build`, no full suite; `timeout 600` on direct runs; no daemon or checkout left; run `pnpm run check:private` (write `~` for home paths; it also rejects the company name and local folder names).

## 023-06 `squeal status --at <commit> [<path>...] [--json]` — Use /worker.

Outcome: the read-only command of D1 and D3, without `--run` (023-07 adds it).
- At the commit: `keysAtCommit` with the named paths (all listed files when none), the checkout by default (the human, 2026-11-17). Per file: `pass`, `fail` with failed tests, `no result`, `absent`, `not determined (<reason>)`, with the origin of a stored result.
- Now: the current state of each file from the running daemon of this worktree (its keys and states: no re-keying); with no daemon, the gate's stored lookup at the working tree's keys as 020 D11.7 reads it, and say so.
- Comparison: pass to fail, fail to pass, unchanged, unknown on either side. Text: changed and unknown files one per line, then counts; when most files have `no result` and the commit is older than 7 days, one line says results are kept 7 days. Exit codes as D1. JSON report versioned, with the commit, `HEAD`, dirty flag, both sides per file and the checkout time.
- Starting seam: `src/cli/status-command.ts` (argument parsing) and a new `src/cli/status-at.ts`; adapters from `daemonAdapters`, as the gate does. Owns: `src/cli/status-at*.ts`, the `--at` branch in the status command, the help text line, their tests. Leaves alone: `src/core/commit/**`, `src/core/ci/**`, delivery, scheduler.
- Done when: CLI tests on a `$TMPDIR` git fixture show each per-file state, the comparison lines, a daemon and a no-daemon current side, the 7-day line, JSON; one real-adapter test runs the command against the commit before a fix and reports the fixed test as `fail -> pass`.

## 023-17 CI's published results at a commit — Use /worker.

Outcome: before the checkout, `keysAtCommit` uses CI's export for that commit when one exists (`refs/squeal/<sha>`, spec 018 D2, D11): a file the export holds, whose environment and key parts the 018 import accepts here, gets the export's key and its pass with origin `ci` and needs no checkout; files the export leaves out (failures, chain manifests, left-out files) go to the checkout as today.
- Reuse 018's fetch and import re-key (`src/core/ci/`, import transfer code); never write the shared store from this path; one fetch per commit per call, bounded by a timeout; no network when the ref is absent locally and fetch is off by policy.
- Starting seam: `src/core/commit/at-keys.ts` (`keysAtCommit`), a new `src/core/commit/at-keys-ci.ts`. Owns those and their tests. Leaves alone: `src/cli/**`, the checkout module, the export side of `src/core/ci/**` (read-only use).
- Done when: on a fixture with an export ref at the commit, exported files take the CI key and pass with no checkout for them; a file the export lacks, or whose environment differs, goes to the checkout; a key from the export equals the key the checkout gives for the same file (exactness); nothing shared is written.
