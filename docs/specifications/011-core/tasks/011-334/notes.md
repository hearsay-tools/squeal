# Row 011-334 notes: the reads beside the run waits give a line, not a stack, on a busy store

Worker ac85bcd7, 2026-11-14. Brief: `tasks/wave-88.md`, W1 (shape: repair, test first). Source: review `reviews/0.1.474.md` N1; `tasks/011-327/notes.md` decision 13. Based on `main` at `ad52e994a`.

## Commits

| Step | Commit | What |
|---|---|---|
| Pinned | `0f6fbb66a` | `test/cli/run-busy-reads.test.ts`: three rows over a store a second connection holds the lock of (`lockStore`). Each throws "database is locked" today: `run --all --wait 300` from `filesText` (the review's reproduction), `run --all` that joined a running checkpoint from `joinedCheckpoint`, and the stopped line from `owedText`. |
| Change | `9fbb59f32` | The four reads go through `readBeside` (new, `src/cli/wait/beside.ts`). The pinned rows flipped; the existing locked-store rows of `run-group.test.ts` and `run-lint-group.test.ts` (review 0.1.409 B1) flipped to the new heartbeat words; new rows in `group-pending.test.ts`. |

## What changed

- **One rule, the run waits' (row 011-327):** `readBeside(root, busyTimeoutMs, read)` reads the worktree store through `withStatusStore` with that busy timeout, so a busy store is tried again for at most that bound. It returns `{ read }`, or `{ unread }` with `unavailableText`'s why. `besideBound(deadline)` is `readBound(deadline, now).busyTimeoutMs`: what is left before the deadline, at least 50 ms, at most `STATUS_BUSY_TIMEOUT_MS` (1 s); past the deadline, or with no deadline (`Infinity`), 1 s. The same rule `requestFiles` (row 011-328) uses.
- **`run.ts`:**
  - `filesText` and `joinedCheckpoint` take the run's deadline (`Infinity` without `--wait` or for a bare `--wait`, as `requestFiles` takes it).
  - `owedText` takes it through a new optional last parameter of `checkpointVerdictLine`, `deadline` (default `Infinity`). `runCommand` passes its deadline.
  - `joinedCheckpoint` returns `JoinedUnread { id, unread }` when the store was not read: the join the daemon named stays, as the daemon's word; what the store would add (its kind, record and progress) is the part not read.
- **`group-pending.ts`:** `heartbeatSilence` reads through `readBeside` within its existing `HEARTBEAT_BUSY_MS` (100 ms). It returns `SilenceUnread { unread }` when the store was not read; the `try`/`catch` is gone, since `withStatusStore` turns every failure into a why. `holderText` takes that and words it.

## The new lines

Each is `<part> was not read (<why>)`, in place of the part. `<why>` is `unavailableText`'s, the words the run waits print for an unread store (row 011-327). For a busy store it is `store busy, waited <ms> ms: another process holds the store's lock; run the command again once it is released`. For a store that does not open it is, for example, `no Squeal store at <path>`, `store version newer than this Squeal (…)`, `store at <path> is corrupt`, or `store unreadable: <error>`.

1. **Start line of `run --all` / `run --fast`** (spec 005 D1's start line), in place of `, M already current`:
   `Checkpoint c1 started at revision 1: 1 test file to run, the count already current was not read (<why>)`
2. **Start line of a request that joined a running checkpoint**, in place of `, joining the <baseline|`run --all`> checkpoint c0 already running them (D of T test files done); it ends when that one ends` or `…; both had ended when this command read them`:
   `, joining the checkpoint c0 already running them, whose progress was not read (<why>)`
   The verdict line after such a start counts only the files, as for a joined checkpoint whose record is gone: `completed at revision N: …; T test files`.
3. **The stopped line** (`run --all --wait`, the daemon stopped before the checkpoint ended), in place of `; the next daemon resumes it, and \`run --all --wait\` then waits for it` (or nothing):
   `has no verdict: the daemon stopped before it ended (<stopped why>); whether the next daemon resumes it was not read (<why>)`
4. **`run <group> --wait` / `run <lint group> --wait` past the deadline before the daemon took the request**, in place of `the daemon's main thread has sent no heartbeat for <age>`, and first among the details:
   `Group e2e has no verdict: the deadline passed before the daemon took request g1; the daemon's heartbeat was not read (<why>); it waits for the daemon's startup, which has run for 5 s. The request stays pending: wait again with squeal run e2e --wait.`
   Other facts of the main thread stay in their part after it: `…; the daemon's heartbeat was not read (<why>); the daemon's main thread has not read the request for 21 s`.

No other line or exit code changes: a store that is read gives each line as before (the existing rows of `run-all-owner`, `run-covered`, `run-lanes`, `run-all-verdict`, `daemon-socket`, `wait/lines` and `group-pending` pass unchanged).

## Decisions the brief did not settle

1. **Unread also covers a store that does not open, not only a busy one.** Before, `inStore` returned `null` for a store that did not open: `filesText` dropped the count without a word, `owedText` said nothing, and `joinedCheckpoint` gave `null`, so the start line named no join and the verdict counted "run now" against a join the daemon had named. A read that threw (not busy) gave a stack. Now each says `was not read (<why>)`, as the brief's "busy and unread cases" allow. A store that does not open after the daemon answered from it is rare; no test fixture in the affected rows reaches it.
2. **`group-pending.ts` keeps its 100 ms bound**, not `readBound`'s. Its read runs after the deadline, where `readBound` gives the full 1 s; review 0.1.409 B1 chose 100 ms because the read only adds a detail to a line the deadline already decided, and the two command rows keep their "in time" check (under 1.5 s with `--wait 300`). It is still `withStatusStore` with a bounded busy timeout, the brief's rule.
3. **`filesText` and `joinedCheckpoint` stay two reads.** On a busy store a joined request's start line therefore says "was not read" twice, and waits up to two bounds (2 s without `--wait`, before the start line). One read of both parts would halve that, but it changes the seam the brief names (one row each). The coordinator can ask for the merge as a follow-up.
4. **The `owedText` row is a line row, not a command row.** A command cannot reach the stopped line while a second connection holds the lock: a locked store ends the checkpoint wait `unopened` before its daemon read, so the outcome is never `stopped`. The row calls `checkpointVerdictLine` with the `stopped` outcome over a locked store, as `test/cli/wait/lines.test.ts` pins the wait's lines. It also checks the bound: with 100 ms left the read ends in under 1 s.
5. **The joined-but-unread start line says "the checkpoint c0"**, without "baseline" or "`run --all`": the kind comes from the record that was not read.

## `inStore`

`inStore` in `src/cli/wait/reads.ts` has **no callers left** (`grep -rn inStore src test`: only its definition). It is left in place, as the brief asks, since row 011-331 works in `reads.ts`. Whoever owns `reads.ts` next can delete it; nothing imports it.

## Type changes (all additive)

- `src/cli/wait/beside.ts` (new): `Beside<T>`, `readBeside`, `besideBound`, `notReadText`.
- `src/cli/run.ts`: new export `JoinedUnread`; `checkpointVerdictLine` takes `joined: Joined | JoinedUnread | null` (was `Joined | null`) and a new optional last parameter `deadline` (default `Infinity`). Private `filesText`, `owedText` and `joinedCheckpoint` take a `deadline`; `joinedCheckpoint` and `joinedText` take or return `JoinedUnread`.
- `src/cli/group-pending.ts`: new export `SilenceUnread`; `heartbeatSilence` returns `number | null | SilenceUnread` (was `number | null`); `holderText`'s second parameter is `number | null | SilenceUnread` (was `number | null`).

## Checks

- `pnpm run lint`: `Checked 3390 files … No fixes applied.`
- `pnpm run typecheck`: exit 0, no output.
- `squeal status --wait 60000` on `test/cli/group-pending.test.ts`, `test/cli/run-busy-reads.test.ts`, `test/cli/run-group.test.ts`, `test/cli/run-lint-group.test.ts`, `test/cli/wait/lines.test.ts`, `test/cli/run-all-owner.test.ts`: 6 test files, no known failures, each current at revision 12.
- `squeal status --wait 60000 test/keys/key-format.test.ts test/version-sensitive.test.ts`: 2 test files, no known failures; no key-format raise.
- `squeal status --wait 60000` on the other test files that reach these lines: `run-covered`, `run-lanes`, `run-all-verdict`, `run-all-verdict-daemon`, `daemon-socket`, `group-pending-release`, `run-group-daemon`, `wait/run-loop`, `wait/covered`, `wait/first-request` (10 files), then `daemon/drain-checkpoint`, `daemon/runtime-gone`, `status/checkpoint`, `evals/retry-claim`, `evals/retry-run`, `retry/gate`, `scheduler/request-covered`, `cli/main`, `cli/warmup`, `cli/warmup-busy`, `cli/warmup-reads` (11 files): no known failures, each current at revision 13.
- The wider affected set (about 285 test files that import `run.ts` through `main.ts`) was still queued behind host load when this was written; see the final report.
- **Bundles:** this row changes CLI code, so the committed plugin bundles differ from the build: `test/harness/opencode/package.test.ts` and `test/harness/pi/package.test.ts` fail with "cli/squeal.mjs differs from the build", as expected. The coordinator rebuilds them on the candidate.

## For the next worker

- The four reads beside the run waits now share `readBeside`; a fifth display read beside a wait should use it, not `openStore`.
- Spec 005 D1 names the start line (`N test files to run, M already current`); lines 1 to 3 above are its unread forms, for the coordinator's amendment. Line 4 belongs to spec 019 D6's group wait (row 011-302's deadline line).
