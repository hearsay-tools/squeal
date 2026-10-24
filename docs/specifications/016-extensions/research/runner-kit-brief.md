# Research brief 016-10: one correctness kit for every runner

Use /researcher. Shape: research. Outcome: whether one set of correctness scenarios can be written once and run against all three of Squeal's runners, what it reuses from today's tests, and which past defects it would have caught. Follow the rules in `README.md`.

Read first: `seams.md` F2 and F5; `ecosystem-adoption.md` findings 4 and 5 and recommendation 5; 011 C3, C4, C5 and C14; `src/core/types/runner.ts`; `test/fixtures/{vitest,node-test,pytest}`, `test/keys/validity/`, and the runner tests under `test/runners/`.

Questions:

1. **Inventory.** A matrix of scenario against runner, with the file and line of the test that covers it, or "none". Scenarios: a source edit flips a test PASS to FAIL; it recovers; an edit two imports away re-runs the dependent file; a deleted test is retired; a file that fails to load; an interrupted run leaves its results unknown; a duplicate test name; a focused run; an environment file change re-keys; a runtime read outside the static closure invalidates. Add scenarios you find; say why.
2. **Shape.** Can a scenario be stated once (a fixture template, an edit script, the expected states and transitions) and instantiated per runner? What differs per runner (fixture syntax, how a failure is written) and what stays the same?
3. **Probe.** Write one or two scenarios in that shape under `probes/runner-kit/`, and run them against at least two runners through `RunnerAdapter` or a scratch daemon. Use a scratch directory under `/tmp`, with `HOME`, `XDG_RUNTIME_DIR`, `XDG_CONFIG_HOME` and `TMPDIR` set there. Report what passed and what each runner needed.
4. **Past defects.** Would a scenario have caught the review failures that `ecosystem-adoption.md` finding 5 names (node:test wave 2's stale pass through a computed `import()` in a preload; waves 2.5 and 2.6, quoted `NODE_OPTIONS`)? Name others you find in the runners' review files.
5. **Cost.** The lines of test code the kit would add or replace, and what a new runner would have to write to join it. No timings.

Own `runner-kit.md` and `probes/runner-kit/`.
