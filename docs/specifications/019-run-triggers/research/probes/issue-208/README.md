# Throwaway issue 208 probes

This is a source-level research fixture, not a product test or a regression suite.
Run from the repository root with installed pnpm dependencies:

```sh
pnpm exec tsx docs/specifications/019-run-triggers/research/probes/issue-208/probe.mjs
```

The script checks one-minute load against CPU count before creating a temporary Git repository. It calls real Git and Squeal modules, with supplied test closures, cached hashes, no test-result rows and an in-memory metadata store. It checks a tracked directory symlink, an ordinary ignored-input control, and a stored report after an untracked input becomes ignored without HEAD moving. It calls only the unchanged-HEAD branch of the real scheduler report function with a minimal context.

No daemon, runner or suite starts. No dependencies are installed here. Temporary files are removed in `finally`; no `node_modules` belongs in this directory. The saved `output.txt` is the final successful run. The report in `../../issue-208.md` states version equivalence and the limits of this experiment.
