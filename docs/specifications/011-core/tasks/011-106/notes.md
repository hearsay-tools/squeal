# 011-106: a daemon whose own runtime is gone starts no tier and exits as reinstalled, worker notes (2026-10-22)

Brief W1 of `../wave-13.md`, base `a5901f2bf` (0.1.261), after 011-66 in the same branch. Evidence `../../research/issue-72.md` and its probe `../../research/probes/issue-72/probe.sh`; digest `docs/triage/2026-10-22-digest.md` group A. Spec 011 C9 and C11.

## What changed

- The daemon names the directory its code runs from, `RUNTIME_DIR` in `src/core/daemon/daemon.ts`: `<plugin>/dist/cli` in a bundle, `dist/core/daemon` in the `tsc` build. It passes it to the scheduler as `SchedulerOptions.runtimeDir`.
- Before each tier, in the pump beside the install check, the scheduler stats that directory. When it is gone, no tier starts, the queue stays as it is, and `onReinstall` gets `runtimeGoneNote(dir)`. The daemon then runs `#shutdown("reinstalled", 0, note)`, the same exit as a reinstall: one persisted note, the shutdown order, a cleared record, code 0. Unlike `#reinstall`, nothing clears the queue or abandons the checkpoint, so the rows stay `queued` and `close` leaves the checkpoint owed. The successor's `handover` (011-33) runs the files under any `baseline.onStart`.
- When a tier ends, `#ended` stats the directory again. A tier during which the runtime went stores nothing: `interruptedFiles` puts every one of its files in the `requeue` set that `recordTier` takes, once per key, through the same `interrupted:<worktree>` memory as 011-66. A second interruption of the same file at the same key records the run as usual.
- The note: "Squeal's own files at `<dir>` were removed under its running daemon (an upgrade or a cache cleanup); this daemon starts no tier and exits, and its queued test files stay queued: `squeal start` runs them with the installed Squeal".

## gh-72's open question: why the restart re-ran the two false FAILs

Answered by experiment on this base, before this row's change: a throwaway test in the probe's shape, with two copies of one `tsc` build, the daemon run from copy A, copy A deleted during a held tier, then `stop`, `start` and `run --all --wait` through copy B. It was not committed.

- The keys did not move. Each held file's `testFileKeys` key was the same before and after the restart through the other copy. The Vitest environment hash drops the recorder's `--import` from `NODE_OPTIONS` (`withoutInjected` in `src/runners/vitest/environment.ts`), and both copies carry one version.
- The two false FAILs were new failures, so the old daemon queued their one D6 re-run each (task 001-171) and wrote it `pending` in `reruns:<worktree>` (review wave 13i, S1). Its runs table showed that re-run tier `crashed`, as every tier after the deletion did. A crashed re-run neither stores nor ends the memory: `endRerun` runs only when a result is stored. So `reruns:` still held both files `pending: true` at their current keys.
- The successor's `restoreReruns` queues a pending re-run forced at its start, whatever `baseline.onStart` says (011-33). It re-ran both, with copy B's recorder, and they passed. In the researcher's probe, `run --all --wait` came straight after `start`, while those two forced re-runs were still queued. A queued file is not current, so the checkpoint counted all six as "run now": "0 already current". In this repeat the re-runs had landed first, and it read "7 already current, 4 run now".

With this row, a tier during which the runtime went stores no FAIL, so no re-run is queued for it, and the question does not arise.

## Decisions the spec did not settle

1. The check reads the daemon's own module directory, not the recorder file. A missing directory is what the probe shows (`rm -rf` of the plugin). A plugin replaced in place at the same path is out of scope.
2. The exit reason is `reinstalled`, as the row says ("exits as `reinstalled` does"). No new `DaemonExitReason`, so nothing that reads exit reasons changes. The note tells the two apart.
3. The scheduler reuses `onReinstall(note)` for the exit; its doc now names both causes. `#tellReinstall` takes the note, once for both.
4. A tier during which the runtime went queues every file again, the completed ones too, since their children's failures come from the missing recorder. A tier whose files are at their one re-queue already records as usual, which can store the false FAIL. That case needs two removals of the runtime during runs of one file at one key.
5. The runtime is checked only before a tier and when one ends, never while idle. An idle daemon whose runtime went exits at its next tier, or serves reads until its idle exit.

## Proposed spec sentences (spec text is the coordinator's)

- C9, beside the `reinstalled` exit: "Its own runtime going is the same exit: before each tier and when one ends the daemon checks that the directory its code runs from exists, and when it does not, it starts no tier, leaves its files queued, persists one note that names `squeal start`, and exits with code 0 and reason `reinstalled` (row 011-106)."
- C11, after the install-change re-queue: "A tier during which the daemon's own runtime went stores nothing either: its files are queued again, once per file and key, as a tier that crashed while its daemon stopped is (rows 011-66, 011-106)."

## Type changes (additive)

- `SchedulerOptions.runtimeDir?: AbsolutePath` (`src/core/scheduler/options.ts`), and its `onReinstall` doc.
- `runtimeGoneNote(dir)` in `src/core/scheduler/install.ts`, beside `REINSTALL_NOTE`.
- `Interruption.runtimeGone` in `src/core/scheduler/interrupted.ts`.

## Tests

`test/daemon/runtime-gone.test.ts`, three cases in the probe's shape (`daemonSuite({ observe: true })`, so children load the recorder from the daemon's build; copy A is a copy of the suite's build under this run's build directory):

1. A deletion during a live tier: the daemon exits 0 with one note that names `squeal start`; no held file reads FAIL or UNKNOWN; all six rows are `queued`; only the tier's two files started.
2. A deletion with queued work (deleted while idle, then an edit): no file starts, all six rows are `queued`, and the same note.
3. A start through another copy: after case 1's exit, `start` and `status --wait` through copy B give six current files with no known failures, and `run --all --wait` then runs nothing ("11 already current, 0 run now").

All three fail on the 011-66 commit without this row's source change: copy A's daemon never exits, so each times out at 180 s. They pass with it.

## Verification at `1bdb4ddde`

- `squeal run --all --wait`, revision 27: 867 test files current, 5 known failures, exit 1. Four are bundle drift: the plugin, Codex, OpenCode and Pi bundle tests name `cli/ps.mjs`, which bundles `WORKTREE_META_ROWS` and so its new `interrupted` row. Bundles are the coordinator's to rebuild.
- The fifth is `test/scheduler/backlog-slots-overhead.test.ts` test 3, a 011-99 file. It fails on the base too. Run alone with `npx vitest run`, alternating base `a5901f2bf` (a detached worktree sharing this `node_modules`) and this head, at one-minute load 4.5 to 8.3 on 24 CPUs: base 1.24 and 1.25 times one tier's time, head 1.23 and 1.24, against its bound of 1.2. Board row 011-99 records the same failure on main at the CPU limits.
- `test/keys/key-format.test.ts`, `test/store/worktree-meta.test.ts` and `test/daemon/restart-handover-signal.test.ts` (011-65) pass.

## Repair of review 0.1.262, B2: a rejected tier applies no setup outcome (brief W5 of `../wave-13.md`)

- `recordTier` takes `setups`, default `true`. `#record` passes `false` when the runtime went and `interruptedFiles` queued any of the tier's files again. Then no setup check fails or passes and no project is blocked: `failStartup` and `setups.pass` do not run. Run accounting (`runs.finish`, `endTier`), the requeue set and the once-per-key memory are as before.
- A file of that tier past its one re-queue still records as usual, but its report's startup failure is the missing recorder's, not its project's. A file of it that the startup failure kept from running is `unknown`, as a crashed run's file is (D12), with the run's failure as the reason. The project is not blocked and its setup check does not fail. This is the only change for a file outside the requeue set.
- A tier whose every file is past its one re-queue is not rejected: `setups` stays `true`, so its setup failure fails the setup check and blocks the project, as the once-per-key rule says.

Tests: `test/scheduler/runtime-gone-tier.test.ts`, with the catch-up fixture's store and a runner that fails to start as Vitest does without its recorder (the review's probe), two files of one project in tiers of one:

1. The runtime goes during a run that failed to start: both rows stay `queued`, no setup FAIL, and a lookup-only successor runs both and stores no failure.
2. A control: the same failure with the runtime there fails the setup and both files leave the queue, as before.
3. The runtime goes during a run whose files completed, after an earlier setup FAIL: the setup stays failing, both rows `queued`.
4. A second such run of a file at the same key: the setup fails as usual.
5. A tier of a file at its second such run beside one at its first: the first is `unknown` with no setup FAIL, the second stays `queued`.

Cases 1, 3, 4 and 5 fail with `setups` always `true`.

Open: a tier that crashes while its daemon stops (011-66) can carry a startup failure too, when a stop kills the run during global setup. Its not-started files are in the requeue set, and `failStartup` then blocks them. The brief scopes B2 to the runtime's loss, so `setups` is `false` only there. Passing `interrupted.length === 0` would cover both.
