# Wave 83: row 011-327 (the run waits take the status waits' rules)

Coordinator cdd216e5, 2026-11-13. Row 011-326 (`src/cli/wait/`, behaviour preserved) landed as 0.1.471 (`44cfe080d`); its review is `reviews/0.1.469.md` (PASS; N2 is this row's first step). This wave is 011-327 alone. 011-328 follows once card 2's row 011-325 lands (wave 81, coordinator 9ddca779).

Host policy, as in `wave-79.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no probe or harness session under the real `HOME`. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-327

Use /worker. Shape: slice, test first, one commit per step.

Outcome: the run waits and their request loops follow the status waits' rules for a busy daemon, a busy or unopened store, a gone daemon and the deadline's last read, each as a changed cell of the rule table; nothing else a user sees changes.

Read: board row 011-327; `research/waits.md`, decision 4 and the coordinator's calls; `tasks/011-326/notes.md`, "For 011-327 and 011-328"; `reviews/0.1.469.md`, N1 and N2; `GLOSSARY.md`, "Waits" and "Daemon"; spec 005 D1; spec 019 D6.

Seam and lead: `RUN_WAITS` and `REQUEST_LOOPS` in `src/cli/wait/table.ts`, the `GONE` rule, `reads.ts` `inStore`. First edit (review N2): deterministic port rows in `test/cli/wait/` for a request that throws on the unbounded `run-all` and `run-slow` rows and a checkpoint ping that throws, pinned to today's throw; then flip them with the change. Then, one commit each:

1. **Late answers.** The checkpoint, `run-all` and `run-slow` socket cells become `deadline`: every socket request ends by the deadline, and a late answer is a busy daemon, as `askWithin` gives the group rows.
2. **Busy and unopened store.** A busy read is skipped and read again; read the status waits' rule in `status-wait.ts` (`withStatusStore` with a per-read busy timeout bounded by what is left, the deadline's read waiting the full timeout). A store that does not open ends the wait with its reason (`src/core/status/open.ts`, for example "no Squeal store at …"), no verdict, exit 3, in place of "the daemon stopped".
3. **Gone daemon.** The `GONE` rule reads daemon presence's wait view through `watchDaemon` (`src/cli/wait-liveness.ts`), as the status waits do (`status-wait.ts:294`): after `squeal stop` the wait ends at its next read and says so; a handoff is waited through to its bound; a daemon that died is found after the view's grace plus `WAIT_DOWN_MS`. The "daemon stopped" lines name the reason with the status waits' words (`noDaemonText` in `status-wait-lines.ts`; exporting it is allowed, its body is not yours).
4. **Lint group at the deadline.** A lint group whose last check ended by the deadline's read gives its verdict (the lint chain checks "nothing to lint" before "late").

Rules from row 011-326's review: each wait still reads only what its row asks, in the row's order; the tests call the decision and loop the commands call; replace a pinned row, never add a second one for the same case. Keep N1's clock reads as they are unless a step needs to move them.

Owns: `src/cli/wait/**`, `test/cli/wait/**`; the wording of the outcome lines in `run.ts`, `run-slow.ts`, `run-group-wait.ts` and `run-lint-group.ts`; `run-group.ts` except `requestedText`; the run tests whose pinned cases the change flips.

Leave alone: `src/core/**` (`src/core/presence/` and `src/core/scheduler/` are other rows'); `wait-liveness.ts`; `status-wait*.ts`, `status-paths.ts`, `verdict.ts` beyond an import or an export; `daemon-access.ts`; `src/cli/code*.ts`; `run-group.ts` `requestedText` (row 011-324, wave 82); `KEY_FORMAT_VERSION`.

A user-visible change beyond these four cells is not yours: keep today's behaviour and name it in your notes. Ask the coordinator if a `src/core` file must change.

Done when: the row's done-when holds; each changed cell names the status wait it now matches; one loop row each for a busy daemon and a busy store shows no stack trace; an unopened store row gives its reason with exit 3; a `squeal stop` row ends at the next read and names the stop; a handoff row goes on; a died-daemon row ends after the grace and `WAIT_DOWN_MS` on the stepped clock; the lint group's deadline row gives the verdict; `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` pass with no raise; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`. Notes in `tasks/011-327/notes.md`: each cell before and after, each flipped or replaced case, and the exact new lines, so the coordinator can amend spec 005 D1 and spec 019 D6. Your final message lists decisions the record did not settle and type changes.

## R1: review of cand/0.1.474

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43511701813. Pinned to `cand/0.1.474` at `9d70cdb1f0c04c7226682b53cba61f4718944b7a`; range `5042e9b67..9d70cdb1f`: eight worker commits of 664d4f3e, cherry-picked (`dfe5212dc..d7c6ccbe7`), then the 0.1.474 version raise and bundles. The behaviour to compare against is `5042e9b67` (0.1.471 with docs). Read: board row 011-327, `research/waits.md` decision 4, `tasks/011-327/notes.md`, `reviews/0.1.469.md` (N1, N2), this file's W1.

Check, each as proven, plausible or unverified:

1. **Only decision 4 changed.** Every user-visible change (lines, exit codes, timing of the end) is one of decision 4's items 1 to 3, or the coordinator's call that the first `run --all` and `run --slow` request ends by the deadline (notes, "Outside the table"). Any other change is a finding.
2. **The status waits' rules, as they are there.** The busy-store read (`withStatusStore` with `readBound`) matches `status-wait.ts:244-249` and its deadline read; the gone-daemon reading goes through `watchDaemon` and `stoppingOf` as `status-wait.ts:294-301` does; a `squeal stop` ends at the next read; a handoff is waited through to its bound; a dead daemon is found after the heartbeat's grace and `WAIT_DOWN_MS`. Nothing under `src/core/` or in `wait-liveness.ts` changed.
3. **No stack trace on a busy daemon or store** in the waits, the request loops and the first requests. Judge decision 13 (the reads beside the waits, `filesText`, `owedText`, `joinedCheckpoint`, `group-pending.ts`, still throw on a busy store) and decision 6 (a busy lint store still reads as unread) against the row's done-when and decision 4.
4. **One decision path; replace, don't layer.** The tests call the decision and loops the commands call; each flipped case in the notes replaces its old row; `first-request.test.ts` is not a second surface for a case the table owns.
5. **Reads.** Each wait still reads only what its row asks, in order (review 0.1.403 B2); say what the new presence read in the lint group (decision 5) adds.
6. **Decisions 1 to 13** of the notes, and whether the notes' text "For spec 005 D1 and spec 019 D6" describes the candidate exactly.

The coordinator's tree passed lint, typecheck, `check:version`, `test/keys/key-format.test.ts` and `test/version-sensitive.test.ts` (19 tests) at the candidate.

Host policy: no local full suite, no `squeal run --all`, no `pnpm run build`; targeted runs with `env -u PLUGIN_ROOT -u PLUGIN_DATA`; affected results through `squeal status --wait 60000 <paths>`; no probe under the real `HOME`. Write `reviews/0.1.474.md` and commit it on your branch.
