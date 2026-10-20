# Probe: issue 53 (throwaway)

Throwaway. Not product code, not a test. `run.sh` copies `fixture/` into a fresh
git repository under `$TMPDIR`, starts the checkout's Squeal CLI there
(`plugins/claude-code/dist/cli/squeal.mjs`), removes the `gone` nodeTest project
from `squeal.config.json` while the daemon runs, and prints what status and
retry report about the removed project's file. Output: `run.log`.
