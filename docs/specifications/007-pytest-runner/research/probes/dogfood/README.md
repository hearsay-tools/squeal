# 007-18 dogfood probe

Throwaway scripts and trimmed logs behind `../../../lessons.md` (task 007-18, 2026-10-14). Not product code.

## Subject and candidate

- Project: [beeware/briefcase](https://github.com/beeware/briefcase) at `bffc7303f605bbe8e8d079ace3292effeb6b9953` (BSD-3-Clause, `src/` layout, 408 `tests/**/test_*.py` files, `[dependency-groups] test`, pytest 9.1.1 pinned), plus its second pytest project `debugger/` (4 test files). Python 3.13.14, uv-managed.
- Squeal: main at `7debdef9` (0.1.174). A fresh `npm ci && npm run build` of a `git archive` of it is byte-identical to the committed `plugins/{claude-code,codex,pi}/dist`, so the installed plugins are that build. Both marketplaces were renamed `hearsay` in the copy, as 005-18 did, so the plugin id is `squeal@hearsay`.
- Harnesses: Claude Code 2.1.296 (`claude-sonnet-5-5`, effort medium) and Codex 0.160.1 (`gpt-6.1-sol`, effort medium), both as installed for `squeal-e2e` by 005-17.

## Rules followed

- Every clone, environment, daemon, harness and model session ran as the throwaway OS user `squeal-e2e` through `as-e2e.mjs`: 005-17's command line (`sudo -n [--preserve-env=<names>] -u squeal-e2e -H env [-i] HOME=… PATH=… cmd`, cwd `/`), with HOME, TMPDIR, CODEX_HOME, CLAUDE_CONFIG_DIR, XDG_RUNTIME_DIR and uv's cache and Python directories under the case root `/home/squeal-e2e/runs/sq07-18`. Nothing touched the real HOME or its agent configuration, and no third-party agent tooling ran as my user.
- Credentials passed by name only (`E2E_PRESERVE`): `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` for Claude Code, `CLIPROXY_API_KEY` for Codex. Never in argv, never echoed. The case's Codex `config.toml` is a copy of 005's `rel-0168` provider block (it names its key by `env_key`; it holds no secret) with `model = "gpt-6.1-sol"`. `scan.py` checked every file here for the three values, the provider's `base_url` and their hosts: none found.
- Python environments only through uv inside the case root (`uv venv --managed-python`, `uv pip install`); never the system or user Python. My own user's only Python was `python3 -I` reading logs (`timeline.py`, `scan.py`). Code from the clone ran only as `squeal-e2e`.
- Batch-size timings (`bench.sh`) start only while the one-minute load is below 8 and log the load beside each number. Every other number here was taken at the load logged beside it, mostly 20 to 90 on 24 CPUs, from other coordinators' work.
- Raw transcripts stayed in my scratch directory; only timelines, Squeal's texts and metadata are kept here.
- Defects are report lines with reproductions; nothing in Squeal was changed.

## Files

| File | What it does |
| --- | --- |
| `as-e2e.mjs` | Runs one command as `squeal-e2e` (005-18's helper, plus uv's directories). |
| `setup.sh` | Case steps: `dirs`, `pin` (the `git archive` of Squeal), `clone`, `sync`, `install` (both plugins at user scope, the launcher), `setup` (`squeal setup --yes --no-warmup`, committed on the clone's `dogfood` branch), `bench` (a separate clone for the batch runs), `worktrees` (the session worktrees and the seeded bug). |
| `baseline.sh` | One timed `squeal run --all --wait` from the daemon's start. |
| `wtsync.sh` | A worktree's environments: `early` starts the daemon first and syncs under it, polling status each second (D2, open question 7); `late` syncs first (goal 2). |
| `sessions.sh`, `prompts/task.txt` | The two model sessions and their one prompt. |
| `rerun.sh` | One edit (or `git checkout` revert) in a clone with a current baseline; logs the runs and file-runs it causes until quiet. |
| `bench.sh` | Open question 5: full baselines of `bench/` at batch sizes 1, 5, 10, a fresh store each, gated on load below 8. Batch size is not a policy key, so sizes 1 and 10 run a copy of the plugin with `DEFAULT_BATCH_SIZE` changed. |
| `importers.py` | A plain `ast` walk of static test-to-module imports, used only to pick the refactor target. |
| `store.py` | Read-only queries of a clone's Squeal store: `files`, `checks`, `runs`, `stored`, `transitions`, `keys`, `holders`. |
| `timeline.py` | A session's tool calls, Squeal texts and messages from its timestamped transcript. |
| `scan.py` | The secret check above. |
| `logs/` | Setup, baseline, own pytest runs, sync and inheritance runs, re-run probes, the bench and `sessions/` (timelines, Squeal's texts, diffs, truth runs, metadata). |

## Sources

- Spec `../../spec.md` (Goals, D2 to D6, Open questions 5 and 7) and `../../status.md`.
- `docs/specifications/003-node-test-runner/lessons.md` for the report's shape; `docs/specifications/005-agent-adoption/research/probes/dogfood/` for `as-e2e.mjs` and the session flags.
- Squeal source at `7debdef9`: `src/runners/pytest/adapter-files.ts`, `src/runners/pytest/run/run.ts`, `src/core/daemon/pytest-runners.ts`, `src/core/delivery/attribution.ts`, `src/core/delivery/provenance.ts`, `plugins/codex/skills/squeal/SKILL.md`.
