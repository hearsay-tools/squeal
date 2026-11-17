# Throwaway issue-238 control

This is an observation record, **not a replayable benchmark**. `probe.py` is disabled pending replacement of its dependency symlink with an independently prepared fixture. It installs nothing itself, but invoking pnpm in its fixture unexpectedly changed the shared dependency tree. Do not invoke pnpm there or enable the script unchanged.

Actual control command: `python3 docs/specifications/017-lint-checks/research/probes/issue-238/probe.py` (before the guard was added). It made one ignored nested fixture, used the installed launcher `~/.codex/plugins/data/squeal-hearsay/bin/squeal`, and checked load before starting. From that fixture it ran:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal --version
~/.codex/plugins/data/squeal-hearsay/bin/squeal start
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --json
```

The researcher additionally ran these in the fixture:

```sh
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --wait 10000 test/value.test.mjs
~/.codex/plugins/data/squeal-hearsay/bin/squeal status --full
~/.codex/plugins/data/squeal-hearsay/bin/squeal lint src/value.mjs test/value.test.mjs --json
pnpm exec eslint src/value.mjs test/value.test.mjs
pnpm exec oxlint --threads 1 src/value.mjs test/value.test.mjs
```

The last two are recorded for provenance, not recommended for replay. The first pnpm invocation printed `Packages: -447`; results after it were discarded. The script was interrupted before its planned final wait commands. Its `finally` ran `squeal stop --until-start` in the fixture, successfully. The previous incomplete attempt was likewise stopped before the second started. Neither attempt called stop from the checkout root.

Only the Markdown findings, this record, the disabled script and `.gitignore` belong in a docs commit. `fixture/`, its Git metadata, stores and linked dependencies do not.
