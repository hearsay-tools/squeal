# Probes for research/issue-105-findings.md (throwaway)

Throwaway. Nothing here is product code or a test, and nothing here is maintained. Findings: `../../issue-105-findings.md`.

## Rules these probes keep

- No live store, daemon socket or permit pool is opened. Stores are read only from copies (`store.sqlite` with its `-wal` and `-shm`), opened read only. E1 reads copies of its own clone's store.
- Other checkouts are read with `git check-ignore --no-index` and `find` only.
- E1 runs in a clone under `/tmp`, with `HOME`, `XDG_*`, `TMPDIR`, `CODEX_HOME` and `PLUGIN_DATA` under the clone; it unsets `PLUGIN_ROOT`, `PLUGIN_DATA`, `CLAUDE_PLUGIN_*` and the `SQUEAL_*` markers. Squeal and the one hand-run Vitest run at nice 10. It stops its own daemon and removes the clone. It signals nothing.

## E1: which ignored writes make a revision, move a key, queue a file (question 1, and the start pass of question 2)

`fixture/` is shaped like cezarion: `.ai/qa/**` ignored; a fast `unit` project; a slow `e2e` project whose `globalSetup` runs `scripts/env-up.sh`, a shell, which writes `.ai/qa/test-env.json` (pid, start time) and `.ai/qa/build/out.txt`. `e2e/a` and `e2e/b` read the descriptor, `e2e/c` the build output, `e2e/d` nothing ignored. `test/declared.test.mjs` declares and reads `.ai/qa/declared.json`; `test/declared-only.test.mjs` declares `.ai/qa/declared-only.json` and never reads it.

```sh
sh run.sh <squeal-worktree>
```

It uses `<squeal-worktree>/plugins/claude-code/dist/cli/squeal.mjs` and links `<squeal-worktree>/node_modules` for Vitest. Steps: `start`, `run --all --wait`, `run --slow --wait`, then one write per step, each followed by 4 s and a report: the new revisions with their paths (`keys.py --diff`), the moved keys and pending marks, `squeal status`, `git status --porcelain`. The writes: a scratch script and its output in `.ai/qa/1816/`; the declared input created and edited; the declared-only input created and edited; the build output with the same bytes, then new bytes; the descriptor rewritten; `vitest run --project e2e e2e/d.e2e.mjs` by hand; `run --slow --wait`; `stop`, a descriptor change, `start`. Last, the observed sets.

Outputs: `e1-run1-2026-10-26.out` (18:01Z, load 28.96 to 32.72; before the declared-only file and the restart step were added) and `e1-run2-2026-10-26.out` (18:06Z, load 20.63 to 30.43; the full script). The host has 24 CPUs; the load is the host's, not the probe's.

## E2: ignored paths in the stores (questions 3 and 4)

```sh
S=/tmp/i105; P=<this folder>
mkdir -p $S/stores/cezar $S/stores/squeal
cp ~/projects/cezar/.git/squeal/store.sqlite* $S/stores/cezar/
cp ~/projects/squeal/.git/squeal/store.sqlite* $S/stores/squeal/
cd $S
nice -n 10 python3 -I $P/survey.py stores/cezar/store.sqlite ~/projects/cezar an/survey-cezar
nice -n 10 python3 -I $P/survey.py stores/squeal/store.sqlite ~/projects/squeal an/survey-squeal
```

`survey.py` prints revisions by size (question 4), the ignored paths among all revision paths and the revisions made of them alone, the ignored paths in the observed sets with their readers, the ignored files written in the last 24 h with the ones that have a reader, and the revisions that name `.ai/qa/test-env.json`. It classifies paths with `ignored.py`, which splits a batch git refuses (a path beyond a symlink) and drops the refused path. Output at 18:20Z (load 17.96): `survey-2026-10-26.out`. The 24-hour counts move with the clock.

The declared-input check of question 3 takes the literal prefix of each `inputs` glob in both `squeal.config.json` files (the text before the first `*`, `{`, `[` or `?`) and runs them through `ignored.py`; none is ignored.

## Clean up

`rm -rf /tmp/i105`. Done on 2026-10-26 after the last read: no probe process was left, both E1 clones were removed by `run.sh`, and `/tmp/i105` (store copies, analysis files) is removed.
