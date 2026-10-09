# Probes: 004-53 confirmation dogfood of the slow lane (throwaway)

Throwaway scripts and trimmed logs for the section "Confirmation at 0.1.85" in `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-09 from 21:20 UTC, with Node 24.21.0, Claude Code 2.1.296 (`claude -p --model opus`) and the Squeal plugin of the dogfood worktree (`--plugin-dir`, version 0.1.85, `origin/main` at `8b40d341`). The hub's `squeal@hearsay` was disabled in the worktree's untracked `.claude/settings.local.json`; the session's `init` event lists `squeal@inline` 0.1.85 as its only Squeal. Times in the logs are UTC; the slow-tier line's `HH:MM` is local time (UTC+2).

## Rules followed

- One worktree, mine, detached: `git worktree add --detach /tmp/squeal-dogfood3-378b91af origin/main`, `npm ci`, `npm run build` (the build reproduced the committed `dist`; `git status` clean). Removed at the end.
- Config, uncommitted: the committed `squeal.config.json` with `b70fcc2`'s fixture narrowing undone (`test/fixtures/node-test/**` and `test/fixtures/vitest/**` declared again) plus `"slow": {"include": ["test/e2e/**/*.test.ts"], "maxLoadPerCpu": 100}`, as 004-46 had it (`logs/squeal.config.diff`). 10 slow files.
- The shared store (`/home/agent/projects/squeal/.git/squeal/store.sqlite`), which 0.1.62 daemons of other worktrees kept writing throughout, was kept and opened read only.
- No credentials were read. `~/.claude` and `~/.codex` were not edited.
- Daemons: listed in `lessons.md`. Only daemons of the dogfood worktree were stopped or killed, and only ones my session or I had started.

## Files

- `poll-status.mjs <squeal.mjs> <root> <every s> <max s>`: from `../dogfood2`, the checkout pattern renamed. One line per change: load per CPU, daemon pid, counts, `slowPending`, `slowTier` with the published activity, and the text status's slow-tier line.
- `rev-watch.mjs <store> <worktree id> <every s> <max s>`: new. The newest revision once a minute, with the revisions of the last minute and their first changed paths (check 1).
- `permits.mjs`, `store.mjs`, `runs.mjs`, `slow-runs.mjs`: from `../dogfood2`, unchanged except `slow-runs.mjs` reads the day from `DAY`.
- `bin/session.sh`: from `../dogfood2`, unchanged.
- `prompts/sq1.md`: 004-46's sq1, unchanged.
- `logs/`: the poll (`sq.poll.txt`), revisions (`sq.revisions.txt`), permits (`permits.txt`), the session (`sq1.times.txt`, `sq1.result.txt`; the stream-json output is not kept), and the store extracts named in `lessons.md`.
