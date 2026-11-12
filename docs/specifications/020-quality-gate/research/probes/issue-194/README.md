# Probe: issue #194 (throwaway)

Throwaway. Synthetic, not the original cezarion task: no cezarion commit is replayed.

- `fixture/`: a tiny ESM project shaped like #194. `scripts/release.mjs` has `publish()` with a loop and runs it when started as a script. `scripts/test-package.mjs` builds (`scripts/build.mjs` writes `dist/stamp.json`) and then runs `node --test test/e2e/`; no runner listing has `test/e2e`. `test/e2e/release.test.mjs` starts `scripts/release.mjs` as a child process (child variant). `test/e2e/release-inproc.alt` imports `publish()` instead (in-process variant; `run.sh` swaps it in).
- `run.sh <squeal.mjs> [<older squeal.mjs>]`: refuses when the one-minute load is above the CPU count. Each case is a new git repository under one `mktemp -d` in `/tmp`, with `HOME` and `TMPDIR` inside it. The head commit adds one branch to `publish()` and one branch to the test callback (cases 6 to 9: to `publish()` only). Then it runs `squeal code --base HEAD~1 --json`, with `--test` where stated, and prints the verdict, each function's state and gap, `runs[]` and stderr.
- `run.out.txt`: the output of the run recorded in `../issue-194.md`.

Run as recorded:

    C=$HOME/.claude/plugins/cache/hearsay/squeal
    sh run.sh $C/0.1.443/dist/cli/squeal.mjs $C/0.1.440/dist/cli/squeal.mjs > run.out.txt 2>&1

No dependencies; nothing is written to this repository.
