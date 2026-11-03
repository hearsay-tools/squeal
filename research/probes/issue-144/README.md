# Issue 144 throwaway probe

This is research evidence, not a product test or supported tool. It needs only
Node and git. It uses an existing Squeal bundle; it does not build or install
anything. No `node_modules` belongs here.

From the repository root:

```sh
node research/probes/issue-144/run.mjs plugins/claude-code/dist/cli/squeal.mjs research/probes/issue-144/results.json
```

The script checks one-minute load against CPU count before each fixture and
before each live daemon or raw coverage run. Above the CPU count it aborts.
Each fixture is a separate git repository under the OS temporary directory
(`TMPDIR` can redirect that directory). HOME, runtime and user configuration
paths are private to the fixture. Only PATH is inherited. Each daemon is stopped
in `finally`. Scratch files remain for inspection; no daemon remains on success.

Three copies contain identical `scripts/help.mjs`: `showHelp` writes help to
stdout and resolves a promise from the named `onHelpWritten` write callback.
The callback writes `callback-ran` to stderr. Child tests assert exit zero,
stdout and that marker. The in-process test awaits the same promise.

- `child-only`: the test runs the script in a Node child.
- `child-imported`: the test also imports the module, but still calls it only
  in the child. This separates loading a file from running its functions.
- `in-process`: the test calls `showHelp` in its own process.

The fixture's startup policy runs its single missing test. The probe reads
named status, path-specific code text and JSON, then the unscoped code report.
It does not request a full-suite checkpoint. In `child-only`, after stopping
Squeal, it independently runs `NODE_V8_COVERAGE=<private raw directory>
node --test test/help.test.mjs` and extracts the source's V8 function counts.
That is deliberate extra collection for the experiment, not a Squeal result.

`results.json` preserves commands, exits, stdout/stderr, daemon logs, start
loads, runtime identity and extracted raw V8 counts from 2026-11-03. The report
is `docs/specifications/015-coverage-complexity/research/issue-144.md`.
