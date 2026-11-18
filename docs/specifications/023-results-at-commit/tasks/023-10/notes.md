# 023-10 notes: how the dogfood ran

Worker 2d31de9d, 2026-11-18. The results are in `../../lessons.md`, "Round 1 (023-10)". These notes are the residue: how to run such a round again and where the raw data is.

## Scripts (`bin/`)

| Script | What it does |
|---|---|
| `as-e2e.mjs` | Runs one command as `squeal-e2e` in the case root `/home/squeal-e2e/runs/w12` (019-17's, with `~/.local/bin` first on `PATH` and pnpm 12's `pnpm_config_store_dir`). |
| `setup.sh` | Steps `dirs`, `hub`, `install`, `bundles`, `clones`, `deps`, `fixtures`, `round2`. No model runs. |
| `fixture-s5.mjs`, `fixture-s6.mjs` | The hidden-dependency fixture (two commits) and the control's uncommitted bug, run as `squeal-e2e` inside the clone (copied to the scratch folder first, since `squeal-e2e` cannot read this user's home). |
| `prompts.json` | The prompts: `s1` to `s6` (round 1), `r1` to `r5` (round 2, one sentence added). |
| `session.mjs <id>` | One session: git state, load and processes before; `timeout 1200 claude -p --model sonnet` with stream-json and hook events; git state after; `squeal ps`, `squeal stop`; the transcript copied out with every credential value of this environment replaced. |
| `timeline.mjs <log dir> [--full]` | Tool calls, hook texts with SQUEAL, results and the final answer with usage. |

Raw data, while the host keeps `/tmp`: `/tmp/w12-023-10/logs/<id>/` holds `stream.jsonl` (each line stamped with seconds from the start), `timeline.txt`, `timeline-full.txt`, `transcript.jsonl`, `meta.json`, `before.txt`, `after-session.txt`, `after-stop.txt`, `squeal-ps.txt`, `squeal-stop.txt`, `stderr.txt`. The original transcripts stay under `/home/squeal-e2e/runs/w12/claude/projects/-home-squeal-e2e-runs-w12-<id>/`; r2's backgrounded `--run` output is under `/home/squeal-e2e/runs/w12/tmp/claude-1002/`.

## Things that cost time

- The hub is private: `squeal-e2e` has no GitHub credential, so the hub was bundled with this user's `gh` and cloned for `squeal-e2e`; `install.sh` takes it through `SQUEAL_MARKETPLACE`. The plugin itself comes from public github.com.
- `git bundle create <file> <sha>` refuses ("empty bundle"); bundle a ref (`HEAD`) and check the sha first.
- `ps -u squeal-e2e` exits 1 when the user has no process; the first `session.mjs` run died on it before starting the session.
- Agents write to `/tmp` directly, not `TMPDIR` (s2's `/tmp/prev`, `/tmp/out-*.json`, `/tmp/cmp.py`; r3's `mktemp -d /tmp/...`). They are `squeal-e2e`'s files; remove them after the round.
- Claude Code's Bash tool moves a call past 600 s to the background; r2's `status --at --run` did that, and the agent slept until the session's limit. Expect it whenever a call can run near the default budget.
- pnpm installs were 1 to 5 s per clone with a shared store on the same filesystem as the clones (`/home`); `/tmp` is another filesystem on this host.
