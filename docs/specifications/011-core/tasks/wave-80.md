# Wave 80: row 011-329 (runner traits stated once per runner kind, behaviour preserved)

Coordinator 5dc06308, 2026-11-13. The human approved rows 011-329 and 011-330 ("Approve, land, start"; design session 238ba474, architecture review card 8). This wave is 011-329 alone. 011-330 (the report merge) follows after 011-329 lands on main: both edit `composite-runner.ts`. Wave 78 is coordinator 9ddca779's row 011-322 (`src/core/scheduler/`); wave 79 is coordinator cdd216e5's row 011-326 (`src/cli/`).

Host policy, as in `wave-76.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no probe or harness session under the real `HOME`. Not yours: the board, `spec.md`, `status.md` (the coordinator amends the spec text), `plugins/*/dist`, the `package.json` version.

## W1: row 011-329

Use /worker. Shape: slice, test first, one commit per step.

Outcome: `RunnerAdapter` carries one required `traits` object, each runner kind states its traits once beside its own code, every layer carries the object whole, and no width, lane, slot, focus or omitted count changes.

Read: board row 011-329; `research/runner-traits.md` (all of it; the coordinator's calls and the interface there are your contract); `GLOSSARY.md`, "Runners"; spec 011 C14; spec 021 D6, D7 and D20.1.

Seam and lead: `src/core/types/runner.ts` (`RunnerAdapter`, the eight optional trait members, `focuses`, `focusesFile`) and the chain in `src/core/daemon/daemon.ts:555-790`. First edit: `src/core/types/runner-traits.ts` (`RunnerTraits`, `declareTraits`, `NO_TRAITS`; no barrel) with the table test's pure rows. Then:

1. `src/runners/{vitest,node-test,pytest}/traits.ts`. Keep them light (no adapter import): the proxy imports them statically, where `runner-host/runners.ts` loads adapters with dynamic imports.
2. `traits` required on `RunnerAdapter`; each adapter, layer and the proxy carry it; the readers become one call each. Then remove the old members, `focuses`, `focusesFile` and the recovering runner's four trait options.
3. The table test (the record's rows and columns, one row for the daemon's assembled chain); then delete the listed forwarding tests and cases.

Rules this kind of move failed review on:

- **One owner, no bypass** (review `0.1.452.md` B1, B2). The table test reads traits through the path the scheduler reads, never a copy. Every default and clamp sits in `declareTraits`; your notes give the grep (`?? grant`, `?? testFiles.length`, `?? ""`, `?? null`, `?? false`, `?? 0` near a trait) and its empty answer outside the traits file.
- **Reads stay as they are** (review `0.1.403.md` B2). Each trait answers from the same values, at the same moment, as today, including the window after a host dies (`values()` is `null`). The wire stays byte for byte: `HostValues`, `members`, and the start reply's `adapter.focuses` (still sent, no longer read).

Owns: `src/core/types/runner.ts`, `runner-traits.ts`; `src/runners/*/{traits,adapter,index}.ts`; `src/core/daemon/{runner,slow-instance,composite-runner,escaped,idle-gc,daemon,node-test-runners,pytest-runners}.ts`; `src/core/runner-host/{proxy,runners,host}.ts` (host: what it sends must not change); the trait lines of `src/core/scheduler/tiers.ts` (159, 540-546), `slots.ts` (16-17, 54), `slow-tier.ts` (667), `revision.ts` (210), `omitted-test-files.ts` (34), `focused.ts` (1, 30); `src/core/code/gate/plan.ts:90`; `src/core/runner-host/remote/lane.ts:265`; the `traits` line of every hand-written `RunnerAdapter` fake and the shared builders (`catch-up-fixture.ts`, `wall-fixture.ts`, `claims-fixture.ts`); the tests the record deletes.

Leave alone: every other line of `src/core/scheduler/` (row 011-322 moves the request methods there); `src/core/runner-host/remote/` beyond `lane.ts:265` (card 10); `src/core/code/gate/` beyond `plan.ts:90` (spec 020); `src/cli/**` (card 3); `protocol.ts`; `merge` in `composite-runner.ts` (row 011-330); `KEY_FORMAT_VERSION` and every `adapterVersion`.

If a behaviour cannot be kept, stop and ask the coordinator; do not widen the row.

Done when: the row's done-when holds; the scheduler's trait tests, Vitest's `width.test.ts` and `squeal code`'s estimate tests (`test/code/gate/estimate.test.ts`, `plan.test.ts`) pass unchanged; the runner host's parity tests (`test/runner-host/*-parity.test.ts`) pass with only their trait members moved to the table, each named; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-329/notes.md`: the table, each deleted test or case mapped to its table row, the default grep. Your final message lists decisions the record did not settle, type changes, and any call of the record that did not hold.

## R1: review of cand/0.1.473

Use /reviewer (codex gpt-6.1-sol high). Pinned to `cand/0.1.473` at `33918d43ec0ba58d3c99769e673459ca583799b0`; range `73abdb9e1..33918d43e`: fifteen worker commits of 6a5188b3, cherry-picked (`ff8073772..9bc106a04`), the coordinator's spec text (`59548a4bc`), the 0.1.473 version raise and bundles (`a314d0798`), then a coordinator repair before review (`33918d43e`: `focusing()` and `focused-turn.test.ts` set `focuses`/`focusesFile` on the runner with `Object.assign`, which typecheck does not see and nothing reads since the move, so `focused-outcomes.test.ts` failed; they now set `traits`). The behaviour to compare against is `73abdb9e1`. Read: board row 011-329, `research/runner-traits.md`, `tasks/011-329/notes.md`, this file's W1, the 2026-11-13 row 011-329 lines in the `status.md` of specs 011, 021 and 001. Candidate CI: run 43507366266 (run 43501095627 is the same source at `a314d0798`).

Check, each as proven, plausible or unverified:

1. **Nothing a user sees changed.** For each runner kind (Vitest, node:test, pytest with and without a batch size) and each holder (in-process adapter, runner-host proxy, recovering runner before creation, after an idle close and after a host died, the composite, the daemon's chain): the same lane, tier width, slow width, tier part, beside-backlog, backlog slot, focus and omitted count as at `73abdb9e1`. Look hardest at: (a) the recovering runner now asks the live adapter's traits first, where node:test's and pytest's `tierWidth` used the option first; (b) the proxy's node:test and pytest width from `options.policy().tierSize` and pytest's slot from the project's batch size; (c) `vitest/traits.ts` decodes the width table once per table identity: is a table ever changed in place; (d) the clamp now also covers `plan.ts:90` and `remote/lane.ts:265`: can a grant or an answer there be below 1; (e) `slowWidth([])` answers 1; (f) Vitest's slow, group and beside instances now state focus true: does anything read it.
2. **The wire is byte for byte the same**: `HostValues`, `members`, and the start reply's `adapter.focuses`, now `traits.focuses` of a file of no project.
3. **One owner, no bypass** (review `0.1.452.md` B1, B2). Every default and clamp sits in `declareTraits`; the notes' grep finds none elsewhere; the table tests read traits through the path the scheduler reads; `liveTraits` adds no default.
4. **Key format.** `KEY_FORMAT_VERSION` and every adapter version are unchanged. Judge the notes' "The key alarm's covered-lines rule": Vitest's traits kept out of its key component, and the node:test and pytest validity harnesses asking every trait for coverage only (`traitsAsked`). Is any case output changed, and does the alarm still fire for a change that matters? `test/keys/key-format.test.ts`'s main test had no local verdict under a load near 110 on 24 CPUs; read its result in the candidate CI run, or run it if the host allows.
5. **Replace, don't layer, and no dead trait setting.** Look for any other test that sets a trait outside `traits` by `Object.assign`, a cast or a spread, as `33918d43e` fixed; a test whose runner states no focus or lane where it did before now tests something else. Each deleted test or case maps to a table row that proves the same thing; the parity tests keep their trait members by the coordinator's call (`status.md`, change 1); the "read path only" files change no case or expected value.
6. **Scope.** Under `src/core/scheduler/` only the trait-read lines changed; under `runner-host/remote/` only `lane.ts:265`; under `src/core/code/gate/` only `plan.ts:90`; `merge` in `composite-runner.ts` is untouched; the spec text changes only the wording the record lists.
7. **Deviations.** Judge the notes' decisions 1 to 8 and the six changes in the 011 `status.md` line against the row's done-when.

`test/version-sensitive.test.ts` passed on the coordinator's tree at the candidate (7 of 7); lint, typecheck and `check:version` are clean; the build shows no drift.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`. Write `reviews/0.1.473.md` and commit it on your branch.
