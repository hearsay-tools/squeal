# Probes: 004-46 re-dogfood of the slow lane (throwaway)

Throwaway scripts and trimmed logs for the section "Re-dogfood at 0.1.68" in `../../../lessons.md`. Not product code. Nothing here is imported, built or tested by Squeal; delete freely.

Run on 2026-10-09 from 15:20 UTC, with Node 24.21.0, Claude Code 2.1.295 (`claude -p --model opus`) and the Squeal plugin of the dogfood worktree (`--plugin-dir`, version 0.1.69: `origin/main` at `98874f1`, which is 0.1.68's slow lane plus 001-168's completion barrier). The hub's `squeal@hearsay` (0.1.62) was disabled in each worktree's untracked `.claude/settings.local.json`; the session's `init` event lists `squeal@inline` 0.1.69 as the only Squeal. Times in the logs are UTC; the slow-tier line's `HH:MM` is local time (UTC+2). The host's load was 2 to 7.6 per CPU on 24 CPUs throughout, from other agents' test runs.

## Rules followed

- Every worktree was mine, detached, under `/tmp`, and is removed at the end:
  - `/tmp/squeal-dogfood2-58239afe`: this repository, `git worktree add --detach ... origin/main` (`98874f1`).
  - `/tmp/squeal-dogfood2-cezarion-58239afe` (A), `-b` (B) and `-c` (C): `git -C /home/agent/projects/cezar worktree add --detach ... HEAD` (`c07b0bfc`), removed with `git -C /home/agent/projects/cezar worktree remove --force`.
- Configs, builds and edits stayed uncommitted in those worktrees. Nothing was edited, committed or stashed in `/home/agent/projects/cezar` or in this repository's main checkout. Cezar's `git status --short` read `.claude/`, `.opencode/` and `squeal.config.json` untracked before and after.
- The shared stores were opened read only (`node:sqlite`, `readOnly: true`). Nothing there was deleted.
- No credentials were read. `~/.claude` and `~/.codex` were not edited.
- Daemons: hooks of the sq1 session started this repository's daemon; I started every cezarion daemon (`ready.mjs`, then `daemon-fg.mjs`). Every one was stopped with `squeal stop` or exited on its own before its worktree was removed. Nothing I did not start was killed.

## Files

- `poll-status.mjs <squeal.mjs> <root> <every s> <max s>`: from `../dogfood`. One line per change: load per CPU, daemon pid (`@checkout` for the dogfood plugin), counts, `slowPending`, `slowTier` with the published activity, and the text status's slow-tier line.
- `permits.mjs <slot dir> <every s> <max s>`: who holds each slow-slot permit (`slow.lock`, `slow.<i>.lock`), read from `/proc/locks` without taking a lock, one line per change.
- `overlap.mjs <since> <label>=<store>:<worktree id>:<slow regex> ...`: every slow run of several worktrees and the number of slow files running at once, per worktree and in total. A run with no end whose file a later run re-ran is cut at that re-run (its daemon died).
- `ready.mjs`, `store.mjs`, `slow-runs.mjs`: from `../dogfood`, unchanged.
- `daemon-fg.mjs <squeal.mjs> <root>`: runs one daemon as `squeal start` spawns it (`squeal.mjs daemon <root>`, detached), keeps its stderr and prints its exit code or signal. Written after the first two cezarion daemons died without a note.
- `bin/session.sh <id> <worktree> <prompt> <logs> [squeal checkout]`: one `claude -p --model opus --plugin-dir <checkout>/plugins/claude-code --permission-mode bypassPermissions --output-format stream-json` session.
- `bin/group-kill.sh <cezarion root> <test file>`: whether one node:test file signals its own process group, run beside a canary in a new session.
- `prompts/`: sq1.
- `logs/`: polls (`sq.poll.txt`, `cz.poll.txt`, `czc.poll.txt`, `czb.poll.txt`), `permits.txt`, daemon starts and exits (`cz.start.txt`, `cz.daemon-fg*.txt`, `czb.daemon-fg.txt`, `czc.daemon-fg.txt`), the session (`sq1.timeline.txt`, trimmed from the stream-json output, which is not kept, and `sq1.times.txt`), the builds (`czabc.dist*.txt`, `cz.build-nondeterminism.txt`, `czbc.setup.txt`), `cz.group-kill.txt`, and the store extracts named in `lessons.md`.
