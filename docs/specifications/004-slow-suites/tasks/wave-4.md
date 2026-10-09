# 004 wave 4 briefs: what dogfooding found (`lessons.md`, defects 1 to 9)

Common rules: do not run `npm run build`; keep scratch in one `/tmp` directory of your own and remove it; no CPU burners; never delete or kill what you did not start; re-run a failing file alone before calling it yours. Read `lessons.md` first.

## 004-30 the slow slot is handed over between files (defect 2)

Outcome: two worktrees' slow tiers interleave file by file, as D2 says, instead of the holder keeping the slot across its whole tier and its load waits.

Shape: repair. Test first: two schedulers sharing a slot directory, each with three slow files queued and a held load guard in the first; the second runs its first file before the first runs its second. Seam: `src/core/slow/slot.ts` and the slot handling in `src/core/scheduler/slow-tier.ts`: release the slot during the load guard's wait (take it after), and give a waiting worktree one turn (for example a waiter's mark in the slot directory the holder honours by skipping one turn). Keep the one-file-per-tier rule and the 15 s retry.

Owns: `src/core/slow/slot.ts`, the slot lines of `src/core/scheduler/slow-tier.ts`, `test/slow/slot.test.ts`, `test/scheduler/slow-tier.test.ts`. Leave alone: everything else.

Done when: the test; lint, typecheck, the slow and scheduler tests on Node 24 and 22.

Use /worker.

## 004-31 the slow-tier line's four wording slips (defect 8)

Outcome: the line says "sources changed since" only when a source of the declared artifact's build could have changed (not for a slow test file alone, and not for a fresh worktree's start scan), names the revision a current slow result actually ran at, and the text keeps the wait reason the JSON has.

Shape: repair. Test first: one test per slip (a), (b), (c), (d) from `lessons.md` defect 8. Seam: `src/core/state/slow.ts` and `slow-text.ts`.

Owns: `src/core/state/slow.ts`, `src/core/state/slow-text.ts`, `test/status/slow-tier.test.ts`. Leave alone: everything else.

Done when: the four tests; lint, typecheck, the status and delivery tests on Node 24 and 22.

Use /worker.

## 004-32 Squeal's own plugin paths leave the node:test key (defect 7, last point)

Outcome: two daemons of one Squeal version installed at different paths compute the same node:test keys, so a result inherits across them.

Shape: repair. Test first: the same project under two plugin roots keys the same. Seam: the node:test adapter's environment hash (`src/runners/node-test/adapter-environment.ts`) and the argv it keys: the recorder's `--require` and the reporter's `--test-reporter` paths are Squeal's own (as 003-35 treats its recorders in `NODE_OPTIONS`); key them by version, never by path. Raise `NODE_TEST_ADAPTER_VERSION` if keys change.

Owns: `src/runners/node-test/**`, `test/runners/node-test/**`. Leave alone: everything else.

Done when: the test; lint, typecheck, the node:test tests on Node 24 and 22.

Use /worker.

## 004-28 a gitignored declared artifact enters the slow file's key (defect 7)

Outcome: a slow file whose declared `inputs` name a gitignored build output (cezarion's `packages/cezar/dist/**`) is keyed by those files' bytes, so two worktrees with different builds never share its key, and an edit of the build re-keys it.

Read: `lessons.md` defect 7 and its reproduction; spec 004 D5, D6; 001 D3 (declared inputs); `src/core/scheduler/keying.ts` (`#knownFiles`, `createDeclaredInputs`, `updateDeclaredInputs`: today declared globs are matched against tracked files and the ignored extras a closure references only).

Shape: repair. Probe first, test first: print one slow file's key inputs in two worktrees of a fixture whose gitignored `dist` differs, and confirm the key leaves the artifact out; then a scheduler test where the two keys differ and a change to an ignored artifact file re-keys the slow file. Seam: expand declared-input globs against the worktree's files including ignored ones and treat the matches as extras, as closure-referenced ignored files already are. Keep `node_modules` out.

Owns: `src/core/scheduler/keying.ts`, `src/core/keys/**` if the glob expansion lives there, their tests. If the watcher or change feed must learn of the new extras (`src/core/watcher/**`, `src/core/scheduler/batch.ts`), stop and ask me first: the 001 lane's 001-159 is changing them now.

Done when: the probe's finding is in your report; the tests on Node 24 and 22; lint, typecheck, full suite.

Use /worker.

## 004-29 a daemon drains pending slow files before it exits (defect 1)

Outcome: slow files pending when the last session leaves (the end of every `codex exec` and `claude -p` session) run before the daemon exits.

Read: `lessons.md` defect 1; `docs/board.md` row 001-162 (the human's rules, 2026-10-09); 001 D10 (when a daemon exits); spec 004 D2 (idle trigger: "every registered consumer is idle or none is registered").

Rules, decided by the human: when the last consumer is gone and slow files are pending, the daemon drains them before exiting, bounded by `daemon.idleExitMinutes`; a session registering in that worktree during the drain (after `/clear`, `/new`, a reset, or a reopened Codex or Claude) cancels the exit, and the daemon stays fully operational after the drain ends; that session's fast work keeps priority over the drain (a fast tier is never queued behind pending slow files).

Shape: slice. Test first. Seam: the last-session exit in `src/core/daemon/lifecycle.ts` (the 3 s grace) and its caller in `src/core/daemon/daemon.ts`: with slow files pending (the scheduler can say so; `SlowTier` already knows its queue), the grace leads to a drain instead of an exit, and the daemon exits when the slow queue is empty or the bound passes, with one note for each. The drain is no activity for the idle timer; a new registration cancels the pending exit.

Owns: `src/core/daemon/lifecycle.ts`, the exit path of `src/core/daemon/daemon.ts`, an additive method on `Scheduler` (`src/core/types/scheduler.ts`, `src/core/scheduler/scheduler.ts` or `slow-tier.ts`) to ask whether slow files are pending, 001 D10's amendment with a dated line in 001's `status.md` (by agreement), spec 004 D2 and D9's sentences on `exec` sessions, their tests. Leave alone: the store, the runners, the harness.

Done when: tests for a drain with no session, a SessionStart mid-drain still served afterwards with its fast work first, and the bound; lint, typecheck, full suite on Node 24 and 22.

Use /worker.

## 004-33 a new file in an ignored declared directory joins the key (from 004-28)

Planned after 001-159. Today a file that appears in a gitignored declared directory, with no existing declared file changing, is picked up only at the next policy reload or daemon start: the watcher does not report additions under ignored directories. Brief when 001-159 lands.
