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
