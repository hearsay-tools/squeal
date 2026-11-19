# Throwaway issue 247 probe

This is research evidence, not a product test. `probe.sh` creates a small git repository, installs pinned Vitest 5.0.3 with pnpm 10.32.0, commits a baseline and fix, and calls the shipped Squeal CLI three times. It never changes the Squeal product checkout. `node_modules`, the runtime bundle, stores and run output stay out of git.

Run on `apptension-lab` after checking its load, in a new directory owned by this task. Supply a shipped runtime's absolute CLI path. From the VM login shell:

```sh
PROBE_ROOT="$HOME/work/issue-247-e4a2bb83/clean-run" \
SQUEAL_CLI="$HOME/work/issue-247-e4a2bb83/runtime/dist/cli/squeal.mjs" \
bash "$HOME/work/issue-247-e4a2bb83/probe.sh"
```

The clean run used Squeal 0.1.563, Node 26.13.0 and resolved Vite 8.3.8. The script creates and commits its own lockfile; future initial installs may resolve different transitive versions. Each proof's frozen install uses that fixture lockfile. Expected observations for the examined version: thin wrapper `not red` (exit 1); explicitly named kit proves the wrapper but is itself not comparable (overall exit 3); explicit source case alone stays `not red` (exit 1). Exit codes and result text are printed, not asserted. Each proof has a 120-second budget.

Delete the task-owned VM directory after collecting results and confirming no process remains. The experiment's result excerpts and limits are in [the findings](../../issue-247.md).
