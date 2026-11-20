# Issue 254 probe

Throwaway research fixture, not a product test. Run from the Squeal repository:

```sh
node docs/specifications/018-ci-and-shared-results/research/probes/issue-254/run.mjs
```

Uses the committed Claude Code CLI bundle and the existing repository Vitest installation. No install, build, daemon, network, or large suite. Before each three-file run, the script refuses a one-minute load above the CPU count. Each child command has a 90-second timeout. All generated repositories, parts and exports stay in ignored `.tmp/` beside the script; they may be removed afterwards.

The first clean repository has one control test, a test with an unread declared document, and a test with an uncalled literal dynamic import. The second repository makes the latter two tests read their inputs. Each records three passing tests with `CI=true`, then exports in a fresh clone of that fixture commit. It prints selected part evidence and exported closures. Both repositories use one Vitest worker at a time.

[`output.txt`](output.txt) is the successful 2026-11-20 run. `<repo>`, `<scratch>` and `node` replace the local repository, generated scratch directory and Node executable paths; other output is preserved. No raw part files are committed because they carry machine paths. An initial attempt stopped before export because `.gitignore` used `node_modules/`, which did not ignore the fixture's symlink. The script now ignores `node_modules`, and the preserved run uses clean, fresh repositories.

The script tests the issue through the public CLI because reproducing `ci record`/`ci export` is the task; background affected tests cannot supply those observations. No existing product test suite was run.
