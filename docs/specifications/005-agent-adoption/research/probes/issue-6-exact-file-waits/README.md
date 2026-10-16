# Probe: issue 6, exact test-file waits

Throwaway. Evidence for `../../issue-6-exact-file-waits.md`; not part of the suite, not product code. Both scripts work in a new `/tmp` directory of their own and never open this checkout's store.

- `selector.probe.test.ts`: builds closures with the product's `createDeclaredInputs` and `assembleClosure`, stores them as the daemon does, and prints what `selectNamedFiles` (spec 005 D2) selects for a test path and a source path. Five cases: the issue's `.github/scripts/**` shape, the comments' E2E-over-`packages/web/src/**` shape, a control whose inputs cover no other test file, and a test file that imports another. One `ISSUE6 {...}` line per case with `expected` (D2) and `actual`; nothing asserted.
- `run-selector.sh [<copy>]`: copies HEAD to `/tmp/squeal-issue6-XXXX/src-copy`, runs `npm ci --ignore-scripts`, copies the probe to `test/cli/` there and runs it with Vitest. Pass an existing copy to skip the install.
- `run-cli.sh <squeal bin> <dir with node_modules>`: a two-test-file Vitest fixture (`scripts/ledger.test.ts`, `scripts/targets.test.ts`, `scripts/lib.ts`) in `/tmp/squeal-issue6-cli-XXXX`, with a scratch `HOME` and `XDG_RUNTIME_DIR` (so no shared slow slot or permit pool), `CEZ_*` and `CLAUDE_*` unset. Policy `inputs` `{"scripts/*.test.ts": ["scripts/**"]}`, or `INPUT_GLOB=scripts/lib.ts` for the control. Starts the daemon, runs `run --all --wait`, prints the selection of `status --json --wait 60000` for the test path and the source path, edits the test file and waits on it again, then stops the daemon it started.
- `selector-output.txt`, `cli-output-0.1.199.txt`: the recorded runs of 2026-10-16 (commit `a8ceaa80`, package 0.1.200; shipped plugin 0.1.199 at `~/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal`; Node 24.21.0; one-minute load 18 to 39 on 24 CPUs, recorded in the files; selection does not depend on it).

Reproduce:

```sh
./run-selector.sh
./run-cli.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal /tmp/squeal-issue6-XXXX/src-copy
INPUT_GLOB=scripts/lib.ts ./run-cli.sh ~/.claude/plugins/cache/hearsay/squeal/0.1.199/bin/squeal /tmp/squeal-issue6-XXXX/src-copy
```
