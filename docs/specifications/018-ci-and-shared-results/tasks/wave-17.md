# Spec 018 wave 17: follow-ups after the squawk rollout

The human, 2026-11-12: "Next: 1, 2, 3, 4". Rows 018-39 and 018-40 are research (`research/README.md`, topics live-saving and left-out-files). Rows 018-41 and 018-42 below run in parallel: disjoint files.

## 018-41 the old daemon exits early in the re-clone handover tests

Use /worker. Shape: repair.

Outcome: `test/daemon/socket-handover.test.ts` ("keeps the new clone's daemon answering after the old daemon exits, when the repository was cloned again in place") and `test/daemon/scratch-identity.test.ts` ("keeps the new clone's temp directory when the repository is cloned again in place while the old daemon runs") no longer fail with `expected +0 to be null` at `old.child.exitCode`: the old daemon had exited with code 0 before the test checked it.

Evidence: fails here under load (load average 37-55 on 24 CPUs, about 1 in 2 runs on 2026-11-12, at 0.1.441 and 0.1.449 trees alike, with and without row 018-30's ensure.ts change); not yet seen on GitHub CI.

Starting seam: why the old daemon exits after the repository is re-cloned in place (`swap` in the test): read what the daemon watches for its root, store, socket or lock and when it steps down (spec 001 D10). First decide whether the exit is correct product behaviour under load (then the test's assumption is wrong) or a premature exit (then a product fix). A product behaviour change: stop and report before changing `src/`.

Owns: those two test files, `test/daemon/helpers.ts` if needed; `src/core/daemon/*` only after the report above. Leave alone: `ci/`, `src/runners/*`, `src/core/shared/*`.

Done when: both files pass 20 of 20 repeated direct runs at this host's real load (state it) on Node 26 and 22; lint, typecheck. No build, no full suite.

## 018-42 the CI action's warnings go to stderr

Use /worker. Shape: slice.

Outcome: `ci/lib.sh` `squeal_ci_warn` writes its `::warning` line to stderr, so a step's stdout holds only the command's own output (for example `squeal code --json > report.json` or `squeal ci record -- <command> > out` when Squeal cannot run).

First verify from the GitHub Actions runner's documentation or source (github.com/actions/runner, read-only) that workflow commands on stderr are processed; if they are not, keep stdout for the annotation and say so, and only move the other text. The step summary line stays as it is.

Owns: `ci/lib.sh`, `ci/bin/squeal`, `ci/setup.sh`, `test/ci-action/*`. Leave alone: everything else.

Done when: the test/ci-action tests assert the warning on stderr and clean stdout for record pass-through, `squeal code` pass-through and export/publish refusals; lint, typecheck. No build.
