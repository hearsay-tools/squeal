# 020-16b notes: a `prepare` command for node:test entries

Worker 26adafd0, 2026-11-11. Spec D15, on the gate as of `dcafbc887`. For a reviewer and whoever continues.

## Seam map

- **Key.** `types/policy.ts` `NodeTestProject.prepare?: NodeTestPrepare` (`{ command: string[], timeoutSeconds?: number }`). `daemon/policy-node-test.ts` `prepare` checks it: an object with only those two keys, a non-empty argument list whose first element is not empty, and a positive `timeoutSeconds`. A bad value skips the entry with one problem, as every other `nodeTest` key does.
- **Base read.** `gate/policy.ts` `BasePolicy.prepares` (a `Map` from entry name to its `prepare`, present only when an entry has one) comes from the base's `squeal.config.json`, through `prepare.ts` `preparesOf`. `cli/code-gate.ts` passes it and `io.stderr` into `CollectOptions.prepares` and `CollectOptions.output`.
- **Run.** `gate/prepare.ts` `prepareEntry(project, paths, context)` gives `null` when neither the base nor the head declares one. A head declaration that the base lacks gives `not-at-base` and a note, and does not run. Otherwise the base's command runs through `runCommand`: no shell, in its own process group, in the head entry's `cwd` with its `env` over `process.env`, timed out at `min(timeoutSeconds, what is left of the budget)`. The whole group is killed at the timeout, and what is left of it when the command exits. The output goes to `output` as it comes; a line feed is added when it ends mid-line.
- **Collector.** `collect.ts` `knownBefore` replaced the inline stored-evidence lookup. It gives each runner's evidence known without a run. A node:test entry with a `prepare` (at the base or the head) takes no stored evidence. When its `prepare` did not pass, every selected file of the entry reads `notPrepared: true`, `completed: false`, with its closure read and no run. `Evidence.prepares` holds each run, and `budgetEnded` sets `timedOut`. `collectEvidence` stays at CC 19.
- **Evaluator** (by agreement, request 15551d35). `evaluate.ts` `standing` gives the gap `not-prepared` for such a file. `pathEvidence` names `not-prepared`, then `not-finished`, before `no-record`. `rule.ts` treats `not-prepared` as it treats `not-finished`: it rules out 015 D9's subset pass.
- **Report.** `GateRunReport.prepare` (node:test only, by entry, present only when one ran or was due) is `PrepareRun`: `project`, `command`, `outcome` (`passed`, `failed`, `timed-out`, `not-at-base`), `exit`, `durationMs`, `notRun`. A not-prepared file is in `notRun`, not in `notFinished`. The verdict still counts it as a selected file that did not finish.
- **Text.** `code-gate-text.ts`: the gap words, and one line per entry whose `prepare` did not pass.
- **Daemon.** `daemon/node-test-runners.ts` `opened` filters the entries both runner constructors read. An entry with `prepare` gets no runner, so none of its files is listed or run. It is noted once per entry name for the life of the set.

## Decisions the spec did not settle

- An entry with a `prepare` takes no stored evidence (D11.7), whatever the outcome. The daemon does not run such an entry, so a stored result predates the declaration and may come from a stale build.
- A `prepare` whose budget is spent before it starts reads `timed-out` with `durationMs: 0`, and its files read `not-prepared`, not `not-finished`.
- The base's command runs with the head entry's `cwd` and `env` (D15.2: the entry's other keys stay read at the head).
- `runs[].prepare` is a list, because `runs[]` is per runner and a project can have several node:test entries.
- Notes on stderr: one before the command (`node:test entry "x": prepare: <command>`) and one when it does not pass. The note for a head-only declaration says to land it on the base first.
- The daemon's note goes through the runner set's `note`, with no topic.
- `QUALITY_POLICY_VERSION` is 4, with a comment naming both gaps, as the brief says. 020-15a sets the same value.

## Tests

- `test/code/gate/prepare.test.ts`: pass, fail, cannot start, own timeout, budget timeout, spent budget, a left child killed, head-only.
- `test/code/gate/collect-prepare.test.ts`, on the probe's fixture (`test/fixtures/code/gate/prepare`): the helper is measured and passes, and Squeal writes nothing else; a failing `prepare` gives `not-prepared` beside a `unit` loader that alone would prove a pass; no file selected means no `prepare`; head-only; the budget stops the `prepare`, and a passing one leaves the run what is left.
- `test/cli/code-gate-prepare.test.ts`: the base's command runs, not the head's (exit 0); head-only gives exit 3, the note and the text line.
- `test/cli/code-gate-text-prepare.test.ts`, `test/policy/node-test-prepare.test.ts`, `test/daemon/node-test-prepare.test.ts`.
- `test/keys/validity/cases/assemble/prepare.ts`: the `prepare` check in `policy-node-test.ts` is on the key's validity path, so `test/keys/key-format.test.ts` asks a case that runs its lines. The case's node:test entries declare a valid `prepare` and each invalid shape. The last release skips them as an unknown key; this tree keeps the valid one; neither keys a file of them. The keys equal the last release's, so `KEY_FORMAT_VERSION` does not move.

## For whoever continues

- `commands.md` lists `not-prepared` among the gate's gaps and `runs[].prepare` in the JSON report since the merge with 020-15a (row 020-15a+16b I); see 020-15a's notes for how the two rows meet.
- No row adds `inputs` in `squeal.config.json` for `test/code/gate/*` over `test/fixtures/code/gate/**`. An edit of a fixture file alone does not re-run its test.
- Other daemon paths still read `policy.nodeTest` whole: the header's runner list, check groups (`squeal run <group>` on such an entry finds no file), and the slow classification. Explicit daemon runs are 020-16c.
- Not measured: the cost on cezar (`research/probes/build-wrapper/cezar-cost.sh`); the load stayed above 24.
