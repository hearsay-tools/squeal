# Issue 116 throwaway probe

This is a research fixture, not a product regression test. Run from the repository root:

```sh
pnpm exec vitest run --config docs/specifications/011-core/research/probes/issue-116/vitest.config.ts docs/specifications/011-core/research/probes/issue-116/probe.test.ts
```

The probe checks one-minute load against CPU count before creating the fixture. Above that count it stops without running the experiment. It uses installed dependencies; install nothing here and keep `node_modules` out of git.

It calls the real `waitForNamed`, `RunQueue`, promotion publisher/reader and SQLite store. Existing test helpers create and remove a private temporary store. It replaces the daemon record and creates a new queue while a wait is open. The sync answer and daemon replacement are simulated. It starts no daemon, runner, socket or test subprocess. It never connects to or stops a shared daemon.

Two files with equal queue class and unknown duration isolate promotion. B starts behind A, leads after promotion, falls behind after replacement and leads again after a new wait. The active wait must send only one request. Both waits time out because the fixture deliberately never drains. This proves neither real handover latency nor successful validation after a restart.

`evidence.json` records observations and host metadata. `result.txt` is the last executed command output (the intermediate wording assertion failed). The corrected assertion was not rerun: load rose above the permitted CPU count. That intermediate assertion failure records: the actual reason included the correct extra text “no run is open and nothing recorded holds it”; the short expected string was a probe mistake. `evidence.json` is from the first passing run, before this output assertion was added.

Squeal's configured test include does not cover this directory. The explicit one-file command is necessary. The probe is expected to appear as untested in Squeal's product coverage reports; those reports do not observe this separate run.
