# Runner traits: each runner kind states them once, and every layer carries them whole

Design brief from the architecture review of 2026-11-12 (Cezar task af6c0b3f, report artifact d8b46fe2, card 8), designed in task 238ba474 on 2026-11-13 at main `83897e102`. Terms: `GLOSSARY.md` (Lane, Runner traits, Report merge). The decisions below are the human's, taken one at a time on 2026-11-13. Rows 011-329 and 011-330.

## Problem

The scheduler asks a runner a few synchronous questions before it starts a tier: the lane a file waits in, how many files one run starts at once (`tierWidth`, `slowWidth`), which part of a tier a file runs in (`tierPart`), whether an edit's tier may start beside a backlog tier (`besideBacklog`), how many files one backlog slot holds (`backlogSlot`), whether the runner runs single checks of a file (`focuses`, `focusesFile`), and how many test files the listing left out (`omittedTestFiles`). These are the runner traits. Spec 011 C14 calls them scheduling hints and keeps them out of the key (task 011-37).

They are optional members of `RunnerAdapter` (`src/core/types/runner.ts:616-756`: 3 fields, 8 required methods, 11 optional methods). Between the scheduler and an adapter sit up to seven layers, each a `RunnerAdapter` that forwards every trait and restates its default when the inner one has none (`src/core/daemon/daemon.ts:555-790`):

`idleGc.track(afterEachRun(createCompositeRunner([withDaemonRemoteLane(withSlowInstance(recovering(Vitest adapter or HostProxy)))], [node:test set, pytest set])))`

- The recovering runner (`daemon/runner.ts`) takes node:test's and pytest's `tierWidth`, `besideBacklog`, `backlogSlot` and `focuses` as options, because a runner host's proxy would otherwise answer with the defaults (row 021-12). It answers the other traits from the live or the parked adapter (spec 021 D20.1).
- The slow instance, `afterEachRun` and the composite each restate all eight. The composite answers `lane` (the owner's name) and `tierPart` (the owner's index) itself.
- The idle-GC track and the remote lane copy the inner runner with object spread (`idle-gc.ts:161`, `remote/lane.ts:394`); both inner runners are plain objects today.
- The runner host sends `HostValues` (`runner-host/protocol.ts:150-157`: the omitted count and Vitest's `WidthTable` as `unknown`), which `runner-host/runners.ts` decodes by importing Vitest's `width.ts`.

Counted on 2026-11-13 (read in source code; `git log`):

| What | Count |
|---|---|
| Defaults restated outside the adapters | about 29 in 10 files; `?? grant` for `tierWidth` at 7 sites |
| A layer lost a trait | 2 in all history: `85c819478` (2026-10-06, the recovering runner dropped `affectedDetailed`, an optional member since replaced by `affected`), `1735a5add` (2026-10-09, `afterEachRun` dropped `lane`, found by the row that added it, 001-140) |
| A field lost in the report merge | 3: `59d1ca149` (2026-10-14, `skippedFiles`, found the day it was added), `38e5337da` (2026-10-24, `focused`, review `011-core/reviews/0.1.280.md` B1), review `021-remote-store-and-execution/reviews/0.1.457.md` B3 (2026-11-12, a split tier kept one of two setup failures, fixed in `d3ef9514e`) |
| Counted by the review card but another cause | review 001-394 B2 (`8c429c8ce`): the slow selector admitted more files than a project's `maxWorkers`; `slowWidth` was created by that fix |
| Fixes in the layer, runner-set and proxy files since 2026-10-20 | 22: 1 report merge, 10 runner-host lifecycle, 4 remote lane, 7 other |
| When the optional members were added | 11 of 12 between 2026-10-09 and 2026-10-23; `globalSetups` on 2026-11-11, read only by `squeal code` |
| Tests that only check a layer forwards a trait | 10 tests in 9 files |
| Test files that hand-write a `RunnerAdapter` | 40, counting shared builders and partial casts |

Two trait losses in all history is a small count. Both came in the two weeks when traits were being added, and each was fixed within a day. The report merge is where losses still happen. The cost the move removes is mostly structural: each new trait touched every layer, the host's values and a forwarding test.

Nothing a user sees is wrong today. One window is unmeasured: after a runner host dies and before the next one starts, `values()` in the recovering runner is `null`, so Vitest's widths fall back to the grant and the file count. The move keeps that behaviour.

## Decisions (the human, 2026-11-13)

1. **The full move** ("3: Full move"). The traits leave `RunnerAdapter`'s optional members. Each runner kind states them once, beside its own code, in one object every layer carries whole.
   - Rejected: the report merge only; the report merge plus one defaults table and one forwarding helper, with `RunnerAdapter` unchanged (it would have caught the same two trait losses, with no spec change); stop and park the card.
2. **The report merge guard is a second row, after the move** ("1: Second piece, after the move"). Both rows edit `composite-runner.ts`, so they run one after the other.
   - Rejected: inside the move (a bigger change to review and repair), leave it out.

## Coordinator's calls (repo-local; the human may overturn)

- **Shape.** Three interfaces were designed in parallel (design-it-twice, 2026-11-13). The chosen one is a required `traits` field on `RunnerAdapter`. The others: traits attached beside the layers by a symbol property and read through `traitsOf(runner)`, where a layer written as a literal drops them and the reader silently gets the defaults again, the same defect class; and the defaults table above, which the human rejected. A required field turns a dropped trait object into a build error, and object spread carries it.
- **The traits object.** Eight synchronous members, read under the scheduler's lock: `omittedTestFiles()`, `slowWidth(files)`, `tierWidth(file, grant)`, `tierPart(file)`, `besideBacklog(file)`, `backlogSlot(file)`, `focuses(file)` (it replaces the `focuses` field and `focusesFile`) and `lane(file)`. One function builds it from what a runner kind states, applies every default and clamp once, and a constant gives the defaults for a runner that states none. A trait never throws; a width table that does not decode answers as absent.
- **What stays on `RunnerAdapter`.** `name`, `adapterVersion`, the 8 required methods, and the optional asynchronous `recheck`, `globalSetups` and `releaseLane`. They are never read under the lock, and the runner host's start reply names the ones an adapter has (`members`), which stays.
- **Where each kind states its traits.** In `src/runners/<runner>/traits.ts`: Vitest's widths from its `WidthTable` and its omitted count; node:test's width `runner.tierSize`, beside-backlog true, slot 1; pytest's width `runner.tierSize`, beside-backlog true, slot its batch size, focus true. The recovering runner's four trait options go. Before an adapter exists, and while a host is gone, the recovering runner answers with its kind's traits over no values, which are today's answers.
- **The runner host.** The proxy builds its kind's traits from the values the host last sent, through one choice per runner kind that the compiler makes complete. The wire stays byte for byte as it is: `HostValues`, `members` and the start reply's `adapter.focuses` (sent, no longer read). Dropping that field is a later protocol change, not in these rows. `runner-host/runners.ts` stops importing Vitest's `width.ts`.
- **The composite.** It answers from each owner's traits: `lane` is the owner's name, `tierPart` the owner's index and its own part, `slowWidth` the first owner's answer for its leading files, `omittedTestFiles` the sum; a project no member owns yet gets the defaults, with the members' joined names as its lane, as today.
- **The other layers** carry `traits` from the layer inside: the slow instance the fast instance's, `afterEachRun` and the idle-GC track their runner's. The remote lane's spread carries it unchanged.
- **Readers.** The scheduler's trait reads become one call each: `tiers.ts:159` (`laneOf`), `tiers.ts:540-546` (`tierWidth`, `partOf`), `slots.ts:16-17` and `:54`, `slow-tier.ts:667`, `revision.ts:210`, `omitted-test-files.ts:34`, `focused.ts:1,30`. `afterEachRun` reads `lane` and `besideBacklog` from it. `squeal code`'s plan reads `tierWidth` at `src/core/code/gate/plan.ts:90`, one line; its estimates do not change. The remote lane reads `tierWidth` for admission at `remote/lane.ts:265`, one line: that line is the seam card 10 will use.
- **Key format.** Unchanged. The key alarm (`test/keys/validity/entries/`) reaches none of the layer, runner-host, scheduler-selection or `width.ts` files; its entries leave the scheduling hints out by name. Moving `focuses` and `omittedTestFiles` out of `src/runners/vitest/adapter.ts` and `pytest/adapter.ts` may fire those components' alarms; they pass without a version raise when every case's output is unchanged. No adapter version moves.
- **Spec text** (wording only; no rule changes; dated amendment lines in each spec's `status.md`):
  - 021 D6, `start`'s answer: "the values of the synchronous members (`slowWidth`, `tierWidth`, `focuses` and the rest), capabilities" becomes "the values the runner's traits answer from (the files the listing left out, Vitest's widths), capabilities". Events: "when an instance restart changes a synchronous member" becomes "when an instance restart changes those values".
  - 021 D7: "The synchronous members answer from the values the host last reported" becomes "Its traits are its runner kind's (011 C14), answering from the values the host last reported".
  - 011 C14: the interface list names `traits` instead of `omittedTestFiles?`, `slowWidth?` and `lane?`; "an adapter's scheduling hints (`tierWidth`, `slowWidth`, `tierPart`, `besideBacklog`, `backlogSlot`, `lane`)" becomes "a runner's traits (`RunnerAdapter.traits`)"; "`RunnerAdapter.focuses`, the adapter honours them" becomes "the focus trait, whether the adapter that runs a file honours them".
  - 001 D5: "`RunnerAdapter.lane(testFile)` names it" becomes "the runner's lane trait names it".
- **Location.** The traits type, its builder and its defaults in one file under `src/core/types/` beside `runner.ts`, with no barrel (row 015-110); the kinds' statements in their runner folders, which import no other runner's folder (`test/runners/boundaries.test.ts`).
- **Tests: replace, don't layer.**
  - New: one table at the traits' interface. Rows are runner kind by holder: the in-process adapter, the proxy over sent values, the recovering runner before creation and after an idle close, and the daemon's assembled chain once. Columns are the eight traits; pytest with no batch size and with 2; `runner.tierSize` moving from 4 to 6. Composite rows cover `lane`, `tierPart` and `slowWidth` across two owners and a project no member owns.
  - Deleted once the table covers their cases: `test/daemon/tier-width.test.ts`, `beside-backlog.test.ts`, `focuses-file.test.ts`, `slow-width.test.ts`, `test/scheduler/backlog-slot-runners.test.ts`, and the trait cases of `runner-idle.test.ts`, `host-proxy.test.ts`, `node-test-host.test.ts` and `composite-runner.test.ts` (the worker names each case).
  - Stay: the 37 scheduler test files that check what a trait's value does, Vitest's `width.test.ts`, the parity tests less the moved members, and every layer's tests of its own behaviour.
  - The hand-written fakes take the defaults constant or a builder option; the shared builders (`catch-up-fixture.ts`, `wall-fixture.ts`, `claims-fixture.ts`) state their traits through the builder.
- **The report merge** (011-330) stays where the remote lane imports it from, `composite-runner.ts`, so the remote lane's code does not change. Its rules may live in a file beside it. The table pins today's rules, the first setup failure kept among them (task 001-382); the remote lane's own handling of a split tier's second failure stays.

## Not in scope

- Building the runner of a kind in one place (today `daemon.ts`, the runner sets, `vitest-host.ts`, `process-host.ts`, `runners.ts`). By the deletion test each builder has one caller, and one module for all three would be as wide as its body; it would also cross card 10 and the gate. Revisit with a fourth runner kind.
- The protocol fields the move leaves unread, and the `members` list.
- The window after a runner host dies, which keeps today's defaults.
- Where a background run executes and under whose grant (card 10, after spec 021's measurement on 2026-11-19).
- The asynchronous members, `RunReport`'s shape, and the setup-failure rule of the merge.

## Rows (spec 011)

1. **011-329, runner traits stated once per runner kind, behaviour preserved.** Done when: `RunnerAdapter` has none of the eight traits and no `focuses` field, and has a required `traits`; every layer carries it whole; no trait default is written outside the traits file (the notes give the grep); the table test passes, and the listed forwarding tests and cases are gone, each named in the notes; the scheduler's trait tests, the parity tests and `squeal code`'s estimate tests pass unchanged; the runner host's messages are byte for byte as before; `KEY_FORMAT_VERSION` and every adapter version are unchanged and `test/keys/key-format.test.ts` passes; the spec text above is amended.
2. **011-330, one rule per report field in the report merge, behaviour preserved.** After 011-329. Done when: a `RunReport` field with no merge rule fails the typecheck (the notes show it with a scratch field); one table test covers every field's rule over one, two and three parts, two parts with a setup failure each among them; the composite's and the remote lane's tests pass unchanged, less the merge cases the table replaced, each named.

## Process

This is product code in `src/`. A coordinator for spec 011 runs the two rows in order, one worker each. Each candidate needs a passing review before main (`docs/process.md` steps 5 and 6). Order and collisions:

- **Card 2's rows** 011-322 to 011-325 (coordinator 9ddca779) work in `src/core/scheduler/`. 011-322's brief keeps it out of `tiers.ts`, `slots.ts`, `slow-tier.ts`, `revision.ts`, `omitted-test-files.ts` and `focused.ts`; `research/request-intake.md` names this card's lines and shares none. Before dispatch the coordinator checks which files 011-323 to 011-325 edit and tells 9ddca779 its lines.
- **Card 3's rows** 011-326 to 011-328 (coordinator cdd216e5) edit the run waits in `src/cli/`; no file is shared.
- **Spec 020's coordinator** (31e1d860) owns `src/core/code/gate/`: one line at `plan.ts:90`. Tell it before dispatch.
- **Card 10** (the remote lane) must not run at the same time; 011-329 changes one line of `remote/lane.ts`. Spec 021 has no live coordinator and no running row in `src/core/runner-host/` (board, 2026-11-13); check again before dispatch.
- Both rows edit `composite-runner.ts`; 011-330 starts after 011-329 lands.
