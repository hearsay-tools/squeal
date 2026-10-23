# Research brief 011-152: why a new worktree misses results another worktree stored at the same commit

Use /researcher. Shape: research. Outcome: for every file a new worktree's first baseline ran, whether a result at an equal key already existed on the host, and, when one did not, which input made the key differ; then what a change would save.

## Why

The human (2026-10-23) chose "find the missed sharing first" before any change to `baseline.onStart`. In `research/stored-nothing.md` finding 5, squeal's baseline (`lookup-then-run-missing`, the product default) was 58.3% of squeal's 72 h recorded test time; first daemon starts in live worktrees ran 51,256 s, 28,959 s of it with no path changed while no daemon ran. Its open question 4: fresh squeal worktrees missed keys another worktree had run at the same commit, and why was not determined. If they found those results, the baseline would cost little and the default could stay.

## Read first

`research/stored-nothing.md` and `research/probes/stored-nothing/` (`ck.mjs`, `fate.mjs`, `results/checkpoints.txt`); `research/edit-load.md`; `research/key-format-guard.md`; row 011-35's question (keys across releases); 011 C3 (keys, declared inputs, observed reads, the formats read as one), C4 steps 3 and 4, C9 (start), C12, and `status.md` for 011-23, 011-37, 011-85.

## Questions

1. **Each miss.** On fresh copies of the squeal and cezar stores: for each file a worktree's first baseline ran in 72 h, whether a result existed on the host at an equal key before it ran; if not, the nearest stored key of that file at the same commit and the inputs that differ (file blob, a declared input, an observed path, the environment, runner or Node version, key format, a release), with recorded seconds.
2. **Causes.** Group the misses by cause, with shares: a release that moved the key format or a runner version; build outputs or other ignored paths; an observed path that differs per worktree (absolute paths, the worktree name, temp dirs); the commit not being main's; anything else.
3. **The read path.** Whether a result at an equal key that existed was looked up and not found (C4 step 3 and the formats read as one): read in source, then shown on a copy.
4. **What a fix saves.** Per cause, the recorded seconds and CPU-seconds (011-143's 0.32 to 0.59 per recorded second) a fix would keep, and what it costs in correctness. No design.

## Rules

- Copy a store (with its `-wal` and `-shm`) before reading it. Never open a live store, connect to a live daemon socket or touch the live permit pool. Never run a script under `evals/bin/` or `tasks/*/probe/`.
- Probes clone under `/tmp`, never `git worktree add`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and the npm, pnpm and corepack homes under `/tmp`; unset `PLUGIN_ROOT` and `PLUGIN_DATA`. Nice 10, at most 4 test workers, the one-minute load beside every timing. Start nothing between 06:45Z and 07:30Z.
- Stop everything you started and remove your clones at the end.
- Tag every finding: `verified by experiment`, `read in source code`, `read from store`, `read in official docs` or `inferred`. Lead with seconds and shares, then n. Budget about three hours.

Own `research/missed-sharing.md` and `research/probes/missed-sharing/` only. Edit no board, spec, status, test or product file.

Done when questions 1 to 4 each have an answer with numbers and tags and the probe README says how to re-run each. Commit.
