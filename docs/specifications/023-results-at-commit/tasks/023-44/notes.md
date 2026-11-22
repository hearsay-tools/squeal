# 023-44 notes: how round 6 ran

Row 023-44, wave 27, 2026-11-22. The results go to `../../lessons.md`, "Round 6 (023-44)". These notes are the residue: what changed from round 5's harness, where it ran, and where the data is.

## Scripts (`bin/`)

Round 5's scripts (`../023-33/bin/`, described in `../023-33/notes.md`), changed only where listed.

| Script | Change from round 5 |
|---|---|
| `deploy.sh` | Hub entry `e74aa47` (0.1.597), `install.sh` from `squeal--v0.1.597`; scratch `t/<id8>/w27`; prints the hub commit's subject. `LAB` is the ssh target, never written down. |
| `setup.sh` | User `squeal-w27`, case root `~squeal-w27/runs/w27`, Node under `/opt/squeal-w27`. New step `dryat`: a squawk clone, `squeal start`, `status --at HEAD~1 --run`, `squeal ps` and the checkout folders, `squeal stop`, `squeal ps`, `squeal stop --at HEAD~1`, `leftover`, with no model call. |
| `as-user.mjs` | User `squeal-w27`. |
| `session.mjs` | User and case root as above. New: after `squeal stop`, `commit-left.txt` keeps `squeal ps` (it lists the commit daemon spec 023 D7 leaves by design) and the session's checkout folders; then `squeal stop --at HEAD~1` and `--at HEAD`, whose last lines go to `meta.commitStop`, so a commit daemon still running its queue cannot load the next session. The R6 process scan follows, as in round 5. |
| `summarize.mjs` | Adds `still_running` (the `--at` calls whose result says work is still running or setting up) and `joins` (the `--at` calls with `--wait`; the judgements tell a later join from a first call's own `--wait`). |
| `batch.mjs`, `results.mjs`, `prompts.json` | Unchanged apart from names (`prompts.json` checked with `diff` against round 5's). |

Claude Code stays at 2.1.327, as in rounds 4 and 5, so the agent side does not change between rounds.

## Where it ran

- **boat.dev first.** One throwaway sandbox (`boat run`, deleted at once, $0.0001) had Claude Code 2.1.330 but no Claude login: `claude -p` answered "Not logged in". No `ANTHROPIC_*` variable and no credentials file reach it; the account's only environment `base` has no credential profile and the AI credentials proxy off; `boat ai` answers 403 through the local API key. The worker stopped and reported; the human chose the lab VM this once ("Lab VM once", 2026-11-22). The shared notes topic on boat.dev records the check.
- **The lab VM (16:42Z to 17:47Z).** At 16:42Z: load 0.00, no user job, no throwaway user from an earlier round, `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` present by name. Setup, both dry checks (0 processes after `dry`; `dryat` showed the commit daemon in `squeal ps`, removed by `squeal stop --at HEAD~1`, and squawk's e2e server left in the clone), s1-01 alone as a trial (85 s), then the other 19, 3 at once and only while the 1-minute load was below 12 (`batch.mjs --parallel 3`, interleaved s1 and s2). The 1-minute load reached 19.5 at 17:07Z. Teardown: see the lessons section.

## Data (`data/`)

- `judgements.tsv`: per session, round 5's columns plus: calls that returned with work still running, whether a later `--wait` joined it, whether the agent read "still running" right, the commit daemon left after `squeal stop`, and `proof`.
- `summary.tsv`: as round 5's, plus `still_running` and `joins`.
- `<id>/`: `timeline.txt`, `summary.json`, `meta.json`, `after-stop.txt`, `squeal-results.txt`, `leftover.txt`, `commit-left.txt`.
- `batch.log`; `dry-at.txt` (the `dryat` check).

The streams and transcripts were deleted with the work folder. The `git show` lines that named the commit's author read `Author: [redacted]`.

## Things worth knowing next time

- `squeal ps` lists every daemon of the OS user, so with 3 sessions at once `commit-left.txt` shows other sessions' daemons too. Count a session's own commit daemon from `meta.commitStop` (one "Commit daemon stopped at …" per session here).
- `git cat-file -e <commit>:<path>` fails for a path under a tracked directory symlink (`.agents/skills/auto-merge` is mode 120000 in squawk). Use `git ls-tree` on the symlink and check the target path.
- A wide s2 `--run` keeps two daemons of the same user busy (the commit daemon and the worktree daemon, about 1,330 files each). The batch's load gate then holds new starts, so 20 sessions took 54 minutes.
</content>
</invoke>
<invoke name="Bash">
<parameter name="command">cd /home/agent/projects/squeal/.ai/squawk/worktrees/9016d863-9481-49ad-9ced-ce16d466e6d3; tail -5 docs/specifications/023-results-at-commit/lessons.md; grep -n "pending-reason\|group-pending-release" docs/specifications/023-results-at-commit/tasks/023-44/data/s2-09/squeal-results.txt | head -3