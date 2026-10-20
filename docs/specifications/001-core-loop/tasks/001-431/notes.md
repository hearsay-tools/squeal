# 001-431 notes: a run without a recorder gets none from a Squeal around it

Worker 0fa6a96c, 2026-10-20. Repair of the two 001-390 recorder-fidelity
cases that failed only under Squeal's daemon.

## The two paths, and where each is closed

The outer recorder is the daemon's (`dist/observe/recorder.cjs`, loaded by
`--import` in every Vitest worker of the daemon, with its settings in
`SQUEAL_OBSERVE`). A test of Squeal that starts its own Squeal run with
observation off ran that run's processes under the outer recorder in two ways:

1. **Inherited `NODE_OPTIONS`** (Vitest only). With `observe` off,
   `VitestObserver.start()` returned `{}`, so Vitest's workers took the test
   process's `NODE_OPTIONS` (`{...process.env, ...options.env, ...}` in
   Vitest 5's pool) with the outer `--import` in it. node:test's
   `projectEnv` already stripped it (003-35).
   *Source:* `src/runners/vitest/observe.ts` `start()`, now
   `unobservedEnv(process.env)` (`src/runners/observe/runtime.ts`).
2. **The outer spawn hook in the test process** (both runners). The outer
   recorder is active in the process that starts the inner run, and
   `spawn.cjs` `injected` puts it back into every child's env unless that
   env's `SQUEAL_OBSERVE` is another Squeal's (`foreign`: a string `out`
   other than its own). A run that does not observe set none, so its forks,
   threads and `node --test` children got the outer recorder again.
   *Source:* `src/runners/node-test/recorders.ts` `projectEnv` and
   `unobservedEnv` now replace an inherited `SQUEAL_OBSERVE` with
   `UNOBSERVED` (`{"out":""}`).

`UNOBSERVED` names no `root`, so `recorder.cjs` `readSettings` returns
`null` for it: no recorder, old or new, records with it. Its `out` is a
string other than any recorder's own, so `foreign` holds for it in the
0.1.227 recorder too: the fix needs no new recorder in the daemon, and no
`.cjs` behaviour changed (`spawn.cjs` gained comments only).

`NODE_OPTIONS` becomes `""`, not unset, when the recorder was all of it: the
`env` option is spread over `process.env`, and a Worker turns an `undefined`
value into the string `"undefined"` (probe, Node 24.21). A test can tell
`""` from unset; it can do so only under another Squeal, where before this
it saw that Squeal's recorder.

## What an ordinary run gets: nothing (coordinator's condition, 2026-10-20)

`UNOBSERVED` only replaces a `SQUEAL_OBSERVE` the run inherited from
another Squeal. A run under a daemon with observe off and no inherited
`SQUEAL_OBSERVE`, every ordinary user run, gives its test processes no
`SQUEAL_OBSERVE`. Vitest's `start()` returns `{}` and `projectEnv` sets
none. `NODE_OPTIONS` stays as inherited when it holds no Squeal recorder:
`unobservedEnv` leaves it out of the env option, and `projectEnv` keeps it
verbatim. Pinned by `test/runners/vitest/observe-env.test.ts` (`start()` and
`injected` are `{}` with no `NODE_OPTIONS` and with a project's own; with
another Squeal's settings, only `SQUEAL_OBSERVE` is set, or `NODE_OPTIONS`
only less the recorder) and `test/runners/node-test/recorders.test.ts` ("adds
no SQUEAL_OBSERVE where none was inherited", "gives an ordinary run's
processes the env it inherited ..."). All of these use `toStrictEqual`, so a
key holding `undefined` counts as an addition.

## Decision: mark the subtree (the brief's lead), not change the premise

D11 Fidelity makes a verdict Squeal's additions cause a defect at its
source. The node:test case's premise, a child free of any recorder, failed
only because the outer recorder reached into an inner run, and an observing
inner run already kept it out (`foreign`). So the outer recorder now stands
back from any Squeal run, observing or not. "Chosen at every spawn" still
holds wherever the recorder records. A subtree whose settings are another
run's is that run's, and the outer recorder is not there to choose a form.

Cost: the outer run records nothing of what an inner, unobserved Squeal
run's processes read. That was already so for an observing inner run. Those
reads are fixture files the test writes itself.

Detection is by `SQUEAL_OBSERVE` in the env the run inherits. A test that
deletes `SQUEAL_OBSERVE` from its own `process.env` and then starts a Squeal
run still gets the outer recorder. The hook's settings live in its closure,
not in `process.env`. This repository has no such test.

## Tests that pin each path

- `test/runners/vitest/observe-env.test.ts`: the Vitest observer's env,
  off, with and without another Squeal's settings (above).

- `test/runners/observe/unobserved.test.ts`: `unobservedEnv` (`{}` without
  another Squeal; recorder out of `NODE_OPTIONS`, `""` when alone;
  settings to `UNOBSERVED`), and the recorder leaving a sync spawn, a
  `fork` and a Worker with `UNOBSERVED` free of it and unrecorded.
- `test/runners/node-test/recorders.test.ts`: `projectEnv` gives
  `UNOBSERVED` for inherited settings and adds none otherwise.
- `test/runners/vitest/observe-fidelity.test.ts` "names the recorder ...":
  the observe-off run now goes under a stubbed outer recorder and settings
  (`vi.stubEnv`), so plain Vitest checks what only the daemon used to.
  It is red with the HEAD `observe.ts` and green with the fix.
- `test/runners/node-test/run-reads-fidelity.test.ts` is unchanged: in
  plain Vitest no outer hook is active in-process, so only the daemon (or
  the reproduction) exercises path 2 there. The `projectEnv` unit test and
  the recorder test pin the two halves.

## D11 / D4 sentences to amend (for the coordinator)

- D4 says the recorder puts itself into a child's env "whatever env the
  caller passed", and never says a recorder leaves a child with another
  Squeal's settings to that Squeal. Proposed: "A child whose
  `SQUEAL_OBSERVE` is not the recorder's own, a test starting its own
  Squeal, is left as it is. Such a run, observing, puts its own recorder
  and settings in place of the inherited ones. Not observing, it takes the
  inherited recorder out of `NODE_OPTIONS` (`""` when it was all there was)
  and puts `UNOBSERVED` (`{"out":""}`, no worktree, so nothing records) in
  `SQUEAL_OBSERVE`, so its processes run with no recorder (task 001-431)."
- D11, first paragraph, the list of what Squeal adds to the inherited
  environment: add "and, under another Squeal's recorder while not
  observing, that recorder taken out of `NODE_OPTIONS` and
  `SQUEAL_OBSERVE` set to `UNOBSERVED`".
- D11 Fidelity "It is chosen at every spawn, also where the child inherits
  it already": add "except in a run of another Squeal, which chooses its
  own or none".

## Guard and bundles

`src/` changed, so `test/keys/key-format.test.ts` "is bumped whenever the
guarded sources change" fails. The bundles drift: the CLI bundles embed the
TypeScript changes, and `dist/observe/spawn.cjs` the comment change. Both
are left to the coordinator's bundle, as the brief says. Keys themselves do
not move. Vitest keeps the `UNOBSERVED` env out of the resolved config
through `injected`, and node:test hashes only `project.env`.
