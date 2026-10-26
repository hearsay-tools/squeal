# Wave 52

From main after 0.1.345 (`93e710f4e`), 2026-10-26. The human's card of 2026-10-26 on gh-1: "Note + restart check" for Squeal, "Leave as is" for the host. One row. Host load is about 20 to 30 on 24 CPUs, mostly other coordinators' work. Verification follows `docs/process.md`, "Test runs on a shared host" (2026-10-25): no `squeal run --all` and no local full suite.

## W1: 011-250 (gh-1), a daemon stopped by a signal says what stopped it, and a resumed session gets its validation back

Use /worker. Shape: slice. Row 011-250; `research/issue-1.md` (sections 3 to 5, open question 1); 011 C9 (lifetime, `squeal start`), C13 (notes).

Outcome: the stop note names the signal and, on Linux, the service whose control group the daemon ran in, and says the next hook starts a new daemon; a session resumed after such a stop has a validating daemon at its first wait, or the reason it cannot is fixed.

Seam 1: `ownSignals` in `src/cli/daemon.ts:30` and `daemon.stop("signal")` (`src/core/daemon/daemon.ts:306`, `daemon stopped: ${reason}`). First edit, offered as a lead: pass the signal's name, and read `/proc/self/cgroup` once, synchronously, at the signal. Send the exact new note text to the coordinator as a request before you commit it.

Seam 2: research open question 1 (the resumed SessionStart at 09:46:39Z said "A daemon is starting"; a wait 49 s later said none runs). Reproduce in a clone under `/tmp`: a daemon your test started, stopped with SIGTERM, then the SessionStart hook, then `status --wait`. Report what you find before you change the start path.

Owns `src/cli/daemon.ts`, `src/core/daemon/daemon.ts`, `signals.ts`, `ensure.ts` and the hook or status file the repro points to (ask first if another coordinator's), and their tests. Not yours: the board, spec text, `status.md`, bundles, version. No `npm run build`.

Done when a test stops a daemon with SIGTERM and reads the new note; a test with a fake `/proc/self/cgroup` names the unit, and one with none names nothing; the repro's result is in the notes, with a fix and its test if Squeal is at fault; every process a test starts, the test stops.

## All workers

Run lint and typecheck, then `squeal status --wait 60000 <changed paths>`, with `env -u PLUGIN_ROOT -u PLUGIN_DATA`, and paste the output. Run each test file that imports a changed module directly when its result is not current, and say so. Write `tasks/<row>/notes.md` with the cause, the evidence and the commits. Never signal a process you did not start. Never open a live store, socket or permit pool. Make no CPU load on purpose.
