# Probe for `issue-3-preconditions` (throwaway)

Throwaway. Nothing here is product code or a fixture to keep. It reproduces GitHub issue #3 (a slow package suite run without the build output it tests) with the shipped Squeal CLI, against a fresh git repository under one scratch directory, `/tmp/issue3-XXXXXX`. `run.sh` points `HOME`, `XDG_RUNTIME_DIR`, `XDG_STATE_HOME`, `XDG_DATA_HOME` and `XDG_CACHE_HOME` into that directory and clears the rest of the environment (`env -i`), so the daemon's socket, slot locks and store (`<scratch>/repo/.git/squeal/store.sqlite`) are its own. It never touches this repository's store or `/home/agent/projects/cezar`.

| File | What it is |
| --- | --- |
| `fixture/` | A node:test package: `test:unit` (fast, imports `src/`) and `test:package` (`slow: true`, keyed by `"inputs": {"test/e2e/*.test.mjs": ["dist/**"]}`). Its three e2e files import `dist/index.js`, spawn `dist/cli.mjs`, and check the `bin` path exists. `dist/` is gitignored (`_gitignore`, renamed on copy) and only `scripts/build.mjs` writes it, as in a fresh worktree. |
| `run.sh` | Default: start the daemon with `dist/` missing, `run --all --wait`, `status`, `failures`, `why`; then build in place, `run --slow --wait`, `status`, `run --all --wait`, `why`; stop. `MODE=built-first`: build before the daemon starts (the control), `run --all --wait`, `why`, stop. |

```sh
SQUEAL_CLI=$HOME/.claude/plugins/cache/hearsay/squeal/0.1.199/dist/cli/squeal.mjs
SQUEAL_CLI=$SQUEAL_CLI sh run.sh                    # missing, then built
SQUEAL_CLI=$SQUEAL_CLI MODE=built-first sh run.sh   # control
rm -rf /tmp/issue3-XXXXXX                           # the path run.sh prints last
```

Each step's output stays in `<scratch>/out/NN-*.txt` until the cleanup. Results are in `../../issue-3-preconditions.md`.
