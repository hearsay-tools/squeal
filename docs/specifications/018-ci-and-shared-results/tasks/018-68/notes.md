# 018-68 notes: an inner `ci record` inside a node:test test writes no empty node:test part

Repair of the leak 018-60's notes left open (its decision 2; spec 018 D23.5, D24). Wave 24.

## What the phantom part was

A `ci record` a node:test test starts inherits `NODE_TEST_CONTEXT` from the outer test file's
process and passes it to its command (018-60 kept it there on purpose: fidelity, D8, D22). Node
skips every `node --test` of that command itself ("node:test run() is being called recursively
within a test file. skipping running files."). But any OTHER Node process of the command — a
Vitest CLI, `npm` — still executes its `NODE_OPTIONS` preloads, so the node:test CI hook's rule
1 read it as a test file's process: it wrote `<graph>/<pid>.json`, and `readNodeTestRuns`
turned the recorded `ppid` into a silent `node --test` process, so one empty node:test part
with `noFiles` and the "names no Squeal reporter" line. Verified on the 018-60 inner fixture:
2 parts in `inner-parts` (vitest + phantom) before the fix.

The skipped inner `node --test` itself writes nothing either way: a `--test` runner process
never executes `--import` preloads (checked on Node 26: a preload runs in each test file
process only), so the hook does not even load in the runner. The phantom always comes from a
non-`node --test` Node process of the command.

## The fix

`startNodeTestRecording` (`src/runners/node-test/ci-record.ts`) bakes one fact into the
settings: `nodeTest.skipped`, true when the command's env carries `NODE_TEST_CONTEXT`
(presence, as Node reads it: even an empty value skips). The hook
(`src/runners/node-test/ci-runtime/node-test-ci.cjs`) adds `!skipped` to rule 1, exactly as
`nested` does: no process of such a command is a test file's process, so no `<pid>.json`, no
empty part, no "names no Squeal reporter" line. The evidence hook still installs, so those
processes' loads stay in the recording's evidence. `ci-runs.ts` is untouched: with no info
written, its silent path never sees the phantom. The composed path (a Vitest recording that
also wraps node:test) flows the field through `...also.settings` unchanged; the green inner
test proves it, since the inner recording there is the composed one.

## Why recording-level, not per-process (a decision the brief did not settle)

The brief said "tell the two apart by `NODE_TEST_CONTEXT` in that process". A process cannot
tell a `NODE_TEST_CONTEXT` its own `node --test` runner set from one an ancestor inherited:
the values are the same strings ("child", "child-v8"; Node also sets `NODE_TEST_WORKER_ID`,
inherited with it). The one process that genuinely knows is the one that starts the command —
`ci record` — so the fact lives in the settings it hands the hook; "in that process" is the
process the recording runs inside, whose env is the command's env.

Cost: a command of an inner recording that itself clears `NODE_TEST_CONTEXT` (`env -u`) and
then runs a real `node --test` gets no part, silently. Accepted: 018-60's decision 1 already
accepts that an inner recording around `node --test` records nothing, and a test that both
clears the variable and expects recording is none of the project's shapes. A top-level
recording never has `NODE_TEST_CONTEXT` in its env (a parent does not inherit from its
children), so every real run keeps today's behaviour — including a real empty run: with the
reporter named, one completed part with no file (verified: `node --test 'nope/*.test.mjs'`);
without it, no part and no line (no test file process ever wrote an info).

## Tests

`test/runners/node-test/ci-record-inherited.test.ts` (018-60's file, tightened for this row):

3. The node:test test now starts two inner recordings: around `vitest run`, and around a
   `node --test` naming the reporter pair (which Node itself skips). The fixture forwards each
   inner recording's stderr (`console.error`), so the outer run's `said` carries it. Asserted:
   `inner-parts` holds exactly the Vitest part, `inner-node-parts` holds no part, and no
   "names no Squeal reporter" line is said. Before the fix: 2 parts in `inner-parts` and the
   line — the red.

`test/runners/node-test/ci-record.test.ts`: a real empty run (`node --test 'nope/*.test.mjs'`
with the reporter pair) keeps one completed part with no file and prints no line — the case
the row names as kept.

## Checks

- `timeout 600 pnpm exec vitest run test/runners/node-test/ci-record-inherited.test.ts --maxWorkers=1` → 3 passed (red before the src fix, green after).
- `timeout 600 pnpm exec vitest run test/runners/node-test/ci-record.test.ts --maxWorkers=1` → 6 passed (5 before; the empty-run pin is new).
- `timeout 900 pnpm exec vitest run test/runners/node-test/ci-record-nested.test.ts test/runners/node-test/ci-record-refused.test.ts test/runners/node-test/ci-record-reporter-faults.test.ts --maxWorkers=1` → 3 files, 13 tests passed (row 018-54 green; a real run that names no reporter keeps its part and line).
- `timeout 900 pnpm exec vitest run test/runners/node-test/ci-record-allowlist.test.ts test/runners/node-test/ci-record-entries.test.ts test/runners/node-test/ci-record-endpoints.test.ts test/runners/node-test/ci-record-manifest.test.ts test/runners/node-test/ci-record-node-options.test.ts test/runners/node-test/ci-record-stdout.test.ts test/runners/vitest/ci-record-nested.test.ts --maxWorkers=1` → 7 files, 18 tests passed.
- `timeout 900 pnpm exec vitest run test/cli/ci-record.test.ts test/runners/boundaries.test.ts test/runners/vitest/ci-record.test.ts test/ci-action/record-squeal-fails.test.ts --maxWorkers=1` → 4 files, 12 tests passed, exit 0. (A fixture project's own failing test prints into the stream; it is the recorded command, not this suite's verdict.)
- `squeal status --wait 60000 <the four changed paths>`: both changed test files pass at their inputs, through a daemon started for this worktree; the 373 other selected files are unknown at revision 0 (the baseline is lookup-only). No full-suite run: a worker does not request one (human, 2026-10-25); CI keeps that.
- `pnpm run typecheck` → exit 0. `pnpm run lint` → exit 0; 2 findings in `test/ci/endpoints.test.ts`, 1 in `test/code/gate/parts.test.ts`, pre-existing on this branch base (other rows' area), none in this row's files.

Type change: `NodeTestSettings.skipped: boolean`, a new required settings field; the hook reads
it as `=== true`, so settings without it (an older recorder beside a newer hook) behave as
before. No bundle owned (`plugins/*/dist` not rebuilt; nothing under it changed).
