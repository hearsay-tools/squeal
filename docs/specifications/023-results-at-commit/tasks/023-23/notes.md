# 023-23 notes: how round 3 ran

Worker 37851dda, 2026-11-19. The results are in `../../lessons.md`, "Round 3 (023-23)". These notes are the residue: how to run such a round again on the lab VM and where the data is.

## Scripts (`bin/`)

| Script | Where it runs | What it does |
|---|---|---|
| `deploy.sh inputs\|copy\|fetch` | the worker's host | `inputs`: the hub bundle (private, read with this user's `gh`), a squawk bundle up to `0dfe0724c` through a local bare clone, the release's `install.sh`. `copy`: makes `~/work/<task id>/{bin,in,logs}` on the VM and copies this folder, 023-10's fixtures and `timeline.mjs`, and the inputs. `fetch`: copies the VM's logs back without `stream.jsonl` and `transcript.jsonl`. The ssh target comes from `LAB`; it is never written into the repository. |
| `as-user.mjs` | VM, as `agent` | 023-10's `as-e2e.mjs` for the throwaway user `squeal-w15` (case root `~squeal-w15/runs/w15`, Node at `/opt/squeal-w15/node24`). |
| `setup.sh <step>` | VM | `user`, `node`, `dirs`, `claude`, `hub`, `install`, `src`; `prepare <id>` (fresh clone, install, fixture; s7: full warm-up); `prepare-copy <id> <from>` (s7 with a copied store); `remove <id>` (skipped while `<work>/KEEP-<id>` exists); `teardown`. |
| `session.mjs <id>` | VM | One session, as 023-10's, with the prompt of the id's group (`s<g>-<nn>`); redacts every credential value, the API base URL and the VM's host name from what it keeps. |
| `batch.mjs [--parallel n] [--keep] [--prepared] <id>...` | VM | At most 3 sessions at once, each started only while the 1-minute load is below the CPU count; stops starting on `<work>/STOP` or at $25. |
| `summarize.mjs <logs>` | VM | Per session `summary.json` and `timeline.txt`; `summary.tsv`. |
| `prompts.json` | | s1 to s6 exactly as round 1; s7 is s1's prompt. |

Order used: `deploy.sh inputs`, `deploy.sh copy`, then on the VM (`bash -lc`, so nvm loads) `setup.sh user node dirs claude hub install src` one step per call, one trial session, then `setsid nohup node batch.mjs … &` so the batch outlives the ssh call.

## Data (`data/`)

- `judgements.tsv`: per session, the expected command, the command used, the answer's grade and reason, swaps, skill, misread text.
- `summary.tsv`: per session, load at start, exit, wall, commands used, skill, swap-like commands, edits, result events, git status after, tokens (cumulative `modelUsage`) and cost (the last `total_cost_usd`).
- `<id>/`: `timeline.txt` (023-10's format, results cut to 600 characters), `summary.json` (the Squeal commands with their second, swap-like commands, edits, the first and the last final answer), `meta.json`, `after-stop.txt` (the clone's HEAD, status, stash, reflog, worktrees, Squeal's checkouts and the user's processes after `squeal stop`).
- `batch.log`; `s7-0[2-5].prepare.txt`: the store copy's check (`squeal status --wait 120000 --full`).

The full streams and Claude Code's transcripts stay on the VM (`~/work/<task id>/logs/<id>/stream.jsonl`, `transcript.jsonl`; `~squeal-w15/runs/w15/claude/projects/`) until the coordinator lets them go.

## Things that cost time

- The VM's Claude Code has no login file: it reaches the API through `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN`, and a direct call with them works (the proxy variables are not needed). Check by names and status codes only.
- The `agent` home on the VM is `750`: the throwaway user cannot read `~/work`, so `setup.sh dirs` copies the inputs and fixtures into the case root, and checks on the user's files run through `sudo -u` (a `test -f` as `agent` failed the first store copy).
- Do not overwrite a shell script while `sh` runs it: copying a new `setup.sh` during s7-01's 32 min warm-up broke its last line (`short: not found`, exit 127) after every real step had run, and the batch then skipped s7-01's session.
- `total_cost_usd` in Claude Code's result events is cumulative, and a background task's notification starts another turn with another result event: sum only the last one. `usage` is the last turn's; `modelUsage` is cumulative. The first batch log's running total ($5.62) counted some sessions twice; the true total is $4.16.
- squawk's full warm-up (`squeal run --all --wait`) took 32 min at load about 11 on 12 CPUs and ends with exit 3, since the `browser` group runs only on request.
- A `setsid nohup … &` inside `ssh '…'` still held the ssh call open until the local tool moved it to the background; stopping that local call did not stop the batch.
