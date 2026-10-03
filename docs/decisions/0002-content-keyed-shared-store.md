# 0002. Results are content-keyed and live in one SQLite store under the git common directory

Date: 2026-10-03
Status: accepted

## Context

Project state must live in the main worktree and be shared by every worktree of the repository. A new worktree must inherit the baseline without re-running. Uncommitted edits exist in every worktree, so a commit SHA cannot describe what a test actually ran against. Several daemons and many short-lived hook processes read and write concurrently. Evidence: `docs/specifications/001-core-loop/research/result-fingerprinting-prior-art.md` and `watcher-daemon-and-shared-store.md`.

## Decision

- A result is keyed by `sha256(environment hash, project, test path, sorted (path, git blob hash) over the test file's closure)`. Commit SHA, revision and worktree are provenance beside the result, never part of the key.
- File hashes use git's blob definition everywhere, read from the index only for clean files without eol or filter attributes.
- The store is `<git-common-dir>/squeal/`, a single SQLite database accessed through `node:sqlite` in WAL mode, plus per-worktree lock databases and run logs.

## Alternatives considered

- Key by commit SHA. Cannot represent dirty trees, shares nothing between worktrees on different commits, invalidates everything on rebase.
- Hybrid with commit in the key. Same failure modes for dirty trees; content key already covers the clean case.
- JSON files with atomic rename. Lost 75% of concurrent updates without a lock; with a lock file it was about 500 times slower per write and left stale-lock hazards after a kill.
- State under the user's XDG state directory. Works, but separates state from the repository it describes and complicates discovery from hook scripts.
- Store inside the worktree tree. Would be watched, could be committed, and would not be shared.

## Consequences

- A new worktree's baseline is a lookup: hash all files from the git index, compute keys from stored closure lists, look them up.
- Turborepo and Nx already share a content-keyed cache across worktrees, so the model has precedent.
- The closure is incomplete by construction (runtime fs reads, env). Policy-declared inputs and the environment hash narrow the gap; status reports the closure method.
- Node 22.13 or later is required for `node:sqlite`. WAL does not work across network filesystems; shared worktrees across hosts are unsupported.
