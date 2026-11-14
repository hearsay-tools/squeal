# Wave 94: rows 011-343, 011-344 and 011-345

Coordinator cdd216e5, 2026-11-14. The human's answers of 2026-11-14 to the card after rows 011-44 and 011-45 landed: "Approve the row" (retry-receipt-wording, now 011-343), "Approve the row" (wait-sync-abort, now 011-344), "Approve, after 011-339" (kept-header, now 011-345; 011-339 landed as 0.1.497). Three rows on disjoint seams, in parallel.

Host policy, as in `wave-85.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on test commands; private `/tmp` fixtures; never the real `HOME`; never make load on purpose. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version, `KEY_FORMAT_VERSION` (stop and ask if key-format asks for a raise).

## W1: row 011-343, `squeal retry`'s receipt says the retry joins the queue, and names the wait

Use /worker. Shape: repair, test first. Effort medium.

Read: board row 011-343; `research/issue-214.md` (F2, question 4); spec 011 C5 and spec 005 D1 where they quote the receipt.

Seam: `loadRetryWhenText` (`src/core/retry/text.ts`) and the receipts in `src/cli/retry.ts` (the no-result receipt's `squeal status --wait 60000 <file>` line, which a failed-result receipt lacks). First edit: rows in `test/cli/retry.test.ts` pinning today's lines, then flip them.

Owns: `src/core/retry/text.ts`, `src/cli/retry.ts`, their tests and any test that quotes the text. Leave alone: when a retry starts (`queueDue`, priorities, #127); `src/core/code/gate` (#214's gate part is spec 020's); W2's and W3's files.

Done when: a load retry's receipt says it joins the queue after the bound, with no start time; a failed-result receipt names `squeal status --wait 60000 <file>`; every other line and exit code unchanged; each changed line, old and new, in `tasks/011-343/notes.md`; lint, typecheck, key-format pass.

## W2: row 011-344, the named and edit waits end without the 2 s socket tail

Use /worker. Shape: repair, test first. Effort medium.

Read: board row 011-344; `tasks/011-49/notes.md`; `reviews/0.1.487.md` (S1, N1); `requestDaemon` (`src/core/daemon/client.ts`), `askDaemon` and `daemonSocket` (`src/cli/daemon-access.ts`), `syncDaemon` and `DaemonSync.stop()` (`src/cli/status-sync.ts`).

Lead: an optional abort signal on `requestDaemon` (destroys the socket, rejects) passed through `askDaemon` and `daemonSocket`; `syncDaemon` aborts it in `stop()`. First edit: a spawned-process test per wait (`status <path> --wait`, `status --wait`) against a socket that accepts and never answers, timing the exit from the outcome; red today at about 2 s.

Owns: `client.ts` (the signal only), `daemon-access.ts`, `status-sync.ts`, their tests. Leave alone: W1's and W3's files, `src/core/presence/`, `src/cli/code*.ts`.

Done when: both tests end within about 300 ms of the outcome; outcomes, lines and exit codes unchanged, the snapshot's (row 011-49) included; lint, typecheck, key-format pass. Notes in `tasks/011-344/notes.md`.

## W3: row 011-345, the fallback `status --wait` keeps its header parts while the states marker stays

Use /worker. Shape: slice, test first. Effort high.

Read: board row 011-345; `tasks/011-45/notes.md` (with its repair round: about 85 ms of a quiet poll is `readHeader`); `reviews/0.1.489.md`, `reviews/0.1.489-r2.md`; `research/progress-records.md` (row 011-339 changed `header.ts`'s record reads); `src/core/state/header.ts`; `src/cli/wait/every-state.ts`.

Lead: split `readHeader` into a part computed from (states, keys, policy), kept with the states while the trusted marker stays, and a part read fresh each poll (revision, runner part, checkpoints, the progress records). The trust rule (`src/core/store/write-markers.ts`) stays as it is. First edit: an equality test, the kept header equal to `readHeader`'s after each kind of write and on quiet polls.

Owns: `header.ts` (the split), `every-state.ts`, `status-wait-held.ts` as its callers need, their tests. Leave alone: `write-markers.ts`; the progress-record owners of row 011-339; W1's and W2's files.

Done when: the equality test; CPU per quiet poll on a cezar store copy before and after, at the stated load, well under 98 ms; outcomes and payloads equal a full read's; lint, typecheck, key-format pass. Notes in `tasks/011-345/notes.md`.

## R1 (W1): review of cand/0.1.504

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43632404705. Pinned to `cand/0.1.504` at `66bb054eb880c720814cd2678fa8d3abaf58a489`; range `cf5f9f00c..66bb054eb`: one commit of worker 291305a0 (`251bd35bb`, cherry-picked from `7a169dcc0` without conflict), then the 0.1.504 raise and bundles. Behaviour to compare against: `cf5f9f00c`. Read: board row 011-343, `research/issue-214.md` (F2, F7, question 4), `tasks/011-343/notes.md`, this file's W1.

Check, each as proven, plausible or unverified:

1. **The receipt promises no start time.** A load retry's receipt says it joins the queue when the load falls below the CPU count or after at most 10 min, and runs in its turn at its normal priority; nothing reads as a start deadline (research F2).
2. **The wait is named, without a priority promise.** Every failed-result `Retry queued` receipt names `squeal status --wait 60000 <file>` and says the wait leaves the retry at its normal priority (F7); the no-result `Run queued` receipts, refusals, `--cancel`, busy and no-daemon lines are unchanged.
3. **Nothing else changes**: when a retry starts (`queueDue`, priorities), exit codes, JSON payloads, and `squeal status`'s pending-retry lines except where they quote the changed text.
4. **Scope**: only `src/core/retry/text.ts`, `src/cli/retry.ts`, the four test files and the notes, apart from the version and bundles; no key change. The worker's calls (wait sentence, unquoted path, eval fixtures left as past output) hold.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive`, every retry and status-retry test file and the bundle tests (25 files, 229 tests) at the candidate. About 990 files import `text.ts` only: CI is their evidence. Host policy as in `wave-85.md`; never the real `HOME`. Write `reviews/0.1.504.md` and commit it on your branch.

## R2 (W2): review of cand/0.1.505

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43635424483. Pinned to `cand/0.1.505` at `ba176011e9ac68ed3ce6de6c6be6cea6d5e58833`; range `c075347d8..ba176011e`: three commits of worker 7d9aa85a (`87785f624`, `580250526`, `657e88140`, cherry-picked from `e85930fbb..a4301c423` without conflict), then the 0.1.505 raise and bundles. It sits on 0.1.504 (row 011-343, reviewed in `reviews/0.1.504.md`; `f9fcc2b64..c075347d8`), which lands on main first. Behaviour to compare against: `c075347d8`. Read: board row 011-344, `tasks/011-344/notes.md`, this file's W2, `reviews/0.1.487.md`, `tasks/011-49/notes.md`.

Grants beyond W2's list (coordinator, 2026-11-14): `src/core/daemon/ensure.ts` (`ProbeOptions.signal`, passed to the lookup ping only); `src/cli/wait-liveness.ts` (`DaemonWatch.stop()`), `src/cli/wait/wait.ts` (`StatusPoll.stop`), one stop line each in `src/cli/wait/status.ts` and `src/cli/wait/named.ts`. The worker found that the liveness watch's ping also held the process about 1.4 s.

Check, each as proven, plausible or unverified:

1. **The process ends near its outcome.** `status <path> --wait` and `status --wait` against a socket that accepts and never answers exit within about 300 ms of their outcome line, every connection closed; codes and lines as at `c075347d8`. `test/cli/status-wait-paused.test.ts` fails on the base.
2. **Nothing changes before the outcome.** No liveness decision, sync answer, read or timing before the wait decides differs; `stop` runs only after it. `src/core/presence/` untouched.
3. **The signal is safe.** `requestDaemon` with an aborted or aborting signal closes its socket, clears its timer and rejects once; every caller that passes no signal behaves as before (the 2 s bound); the snapshot of row 011-49 is unchanged.
4. **Scope**: the files above, their tests and notes, apart from the version and bundles; no key change; `src/cli/code*.ts` untouched.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive`, the new tests, the wait and status-wait tests, the daemon lookup tests and the bundle tests (66 files, 632 tests) at the candidate. Host policy as in `wave-85.md`; never the real `HOME`; signal only processes your probe started. Write `reviews/0.1.505.md` and commit it on your branch.

## R3 (W3): review of cand/0.1.506

Use /reviewer (codex gpt-6.1-sol high). Candidate CI: run 43637995391. Pinned to `cand/0.1.506` at `b09f0095ca32423c8e510ab9ddb263a74dfd59e5`; range `f38b0c9b5..b09f0095c`: five commits of worker 14e7717d (`a250d14fc`, `04fa4a022`, `df430fc8e`, `662d98e87`, `ae1267cc4`, cherry-picked from `864224a8b..9c3c1f5dd` without conflict), then the 0.1.506 raise and bundles. It sits on 0.1.505 (row 011-344, `reviews/0.1.505.md`), which lands on main first. Behaviour to compare against: `f38b0c9b5`. Read: board row 011-345, `tasks/011-345/notes.md`, this file's W3, `tasks/011-45/notes.md` (with its repair round), `reviews/0.1.489-r2.md`, `src/core/state/header.ts`, `src/core/state/header-part.ts`.

Grant beyond W3's list (coordinator, 2026-11-14): `src/core/state/slow.ts` and `src/core/state/groups.ts`, an additive split of each lane's state into counts and activity read fresh; every other caller gets the same object.

Check, each as proven, plausible or unverified:

1. **A kept header equals a full read.** While the trusted states marker stays and the policy reads the same, the kept part plus the fresh part equal `readHeader` at the same point: after each kind of write, a policy change, a lane's activity change, the revision, runner part, checkpoints and progress records. `test/cli/kept-header.test.ts` fails when the part is kept across a policy change.
2. **Reads stay where they were.** The header reads the policy and the store in today's order (`test/presence/reads.test.ts` pins it); the lanes' activity is read each poll; the trust rule in `write-markers.ts` is unchanged.
3. **Nothing a user sees changes**: `status --wait`'s lines, JSON payloads and exit codes, and every other caller of `readHeader`, `readLane` and `readGroupTiers`.
4. **Cost**: the notes' CPU per quiet poll (median 85–96 ms to 1.5–1.7 ms on a cezar copy) is plausible.
5. **Scope**: the files above, their tests and notes, apart from the version and bundles; key-format with no raise; `src/cli/code*.ts`, `src/core/presence/` untouched.

The coordinator's tree passed lint, typecheck, `check:version`, `key-format`, `version-sensitive`, the row's tests, `test/status`, `test/presence/reads.test.ts`, `test/cli/wait`, the latency test and the bundle tests (107 files, 1,296 tests) at the candidate. Host policy as in `wave-85.md`; never the real `HOME`; a store copy lives in private `/tmp`. Write `reviews/0.1.506.md` and commit it on your branch.
