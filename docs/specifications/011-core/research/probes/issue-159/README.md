# Issue 159: throwaway Stop probe

This is research evidence, not a product regression suite. It imports production
Codex hook functions and existing temporary-store helpers. It starts no real
daemon, linter, browser, application, external wait or additional agent.
`node_modules` is not part of this probe.

Run from the repository root, with the existing pnpm installation:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-159/vitest.config.ts docs/specifications/011-core/research/probes/issue-159/stop.test.ts
```

The config selects this one file and one worker. The probe checks one-minute load
against CPU count before any fixture. It uses real SQLite stores, the Codex input
parser, both Stop entries and a socket endpoint that accepts `run-group` but
deliberately leaves one lint check pending. Temporary stores and sockets are
closed and removed by the existing helpers. Daemon startup is replaced by the
helpers' `ensureDaemon: async () => "alive"`.

Each fixture registers after a synthetic revision and a completed daemon scan.
Selected cases then append a revision for `dist/cockpit.js` with `dirty: false`.
No source bytes are edited. The fixture's `.git` layout is fake: this does not
prove that a real reset/build produces that revision or that real Git is clean.
The test names use reset/build to identify the simulated incident state.

The `external_wait` and `completion_claimed` fields are deliberately invented
input hints. The probe confirms that Squeal's parser drops them. They are not
documented Codex or Cezar fields and do not simulate a registered Cezar wait.

The budget is **150 ms**, replacing the production default of 120000 ms. Four
cases reach a pending-lint block. A control with unchanged revision and scan
evidence returns without a lint request. Every case checks that the waiting entry
is silent on its next invocation in the same turn. `lint.blocking` is false.

Recorded at checkout `d3f363054fbe5d30e6e11bf8f212e1ac74d567e1`, Squeal 0.1.414,
Node 24.22.1, Vitest 5.0.3. [output.txt](output.txt) preserves the final run:
5 passed, 4.88 seconds, load 16.85 on 24 CPUs. The first run also passed all five
cases (4.06 seconds), but Vitest hid console output on success. The final run
added `disableConsoleIntercept: true` to preserve observations; no behaviour
change was needed for a pass. Times in the runner footer are Europe/Warsaw;
the JSON host timestamp is UTC.

Verification commands:

```sh
pnpm exec biome format --write docs/specifications/011-core/research/probes/issue-159/stop.test.ts docs/specifications/011-core/research/probes/issue-159/vitest.config.ts
pnpm exec biome check docs/specifications/011-core/research/probes/issue-159/stop.test.ts docs/specifications/011-core/research/probes/issue-159/vitest.config.ts
git diff --check
```

The repository's normal Vitest config includes only `test/**` and `src/**`, so
Squeal does not run this probe. Its untested/CRAP notices concern the throwaway
probe, which the command above executes directly. No full suite was requested.
