# Throwaway issue 141 probe

This is research evidence, not a product test or supported fixture. No `node_modules` is committed. Run from a Squeal checkout with the two release tags and the already installed oxlint 1.90.0 package:

```sh
python3 docs/specifications/017-lint-checks/research/probes/issue-141/probe.py
```

The script overwrites `results.json`. It skips each runtime if one-minute load exceeds `os.cpu_count()`. It extracts the committed bundles with these exact operations (the script pipes archive bytes directly to tar):

```sh
git archive squeal--v0.1.390 plugins/claude-code/dist
git archive squeal--v0.1.392 plugins/claude-code/dist
tar -x -C <scratch>/<version>/release
```

Each version has its own Git repository, home, runtime directory, config directory and temporary directory under `/tmp/sq141-*`. The child environment contains only PATH, those four directories and LANG. The script does not inherit session pins or plugin variables. It links only the existing oxlint package and writes the tiny config/file shown in the report. It neither installs packages nor builds code.

For each runtime it runs the following, with the scratch project as working directory. `results.json` records the expanded argument lists, exit codes, stdout and stderr. `<scratch>` and `<repo>` replace private absolute paths.

```sh
node <oxlint>/bin/oxlint --format json --threads 1 a.js
node <release>/plugins/claude-code/dist/cli/squeal.mjs --version
node <release>/plugins/claude-code/dist/cli/squeal.mjs daemon <project>
node <release>/plugins/claude-code/dist/cli/squeal.mjs status --json
node <release>/plugins/claude-code/dist/cli/squeal.mjs status --wait 3000
node <release>/plugins/claude-code/dist/cli/squeal.mjs lint a.js --json
```

Status reads are bounded polling of this probe's own store only. On 0.1.392, the script fixes the file and repeats JSON reads until the current pass appears. It owns each daemon's process group, sends SIGTERM in `finally`, waits for exit (SIGKILL fallback), checks the group is gone, then removes its scratch tree. The captured successful run used no fallback kill.

The 3-second wait timeout is not a test pass: these minimal fixtures have no test runner or lockfile. Read the lint JSON for the experimental verdict. No full suite or checkpoint is requested.

The bundle identity check was:

```sh
git rev-parse squeal--v0.1.390:plugins/claude-code/dist/cli/squeal.mjs squeal--v0.1.390:plugins/codex-runtime/dist/cli/squeal.mjs squeal--v0.1.392:plugins/claude-code/dist/cli/squeal.mjs squeal--v0.1.392:plugins/codex-runtime/dist/cli/squeal.mjs
```

It returned equal blob pairs: `475df6f96f7a5cdd5a78be407e4cca0b8ad69433` for 0.1.390 and `f5eb36f0a519712fe5c806f6e94878ff46f88099` for 0.1.392. No installed runtime or pin was changed to select the experimental versions.
