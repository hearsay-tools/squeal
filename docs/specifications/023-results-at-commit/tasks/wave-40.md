# Wave 40 (rows 023-83, 023-84): the first browser pair within the first call, and a stale run named as stale. Use /worker.

The human chose (2026-11-24): stop row 023-85 ("Stop it") and go on with rows 023-83 and 023-84, then dogfood round 12. The base is main (0.1.619 on it; spec 023's last code shipped in 0.1.614: waves 36 and earlier).

Read `../spec.md` D3 and D7.3, `../lessons.md` round 11 ("What went wrong": AA2 and AA4; data under `tasks/023-80/data/`), `tasks/023-77-notes.md` and `tasks/023-78-notes.md` (the slot holder record, the follow rule and its leader choice, both review repair sections), and `reviews/0.1.612.md` S1 and S2. Never write the lab VM host name, the company name, sandbox ids or home paths in committed files (`pnpm run check:private` with `set -o pipefail`; also grep your diff). Host is shared: direct vitest only with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; no full suite; no version, no build; nothing left running; wait only on your own jobs. No `RECORDER_VERSION` or `KEY_FORMAT_VERSION` change without a coordinator request first.

## Row 023-83 (AA2): pair the earliest file first, and keep the turns alternating

Round 11: the commit side's first browser run started 56 to 84 s into the session, the working tree's 94 to 178 s; the working tree then followed the commit side's latest file (6 of 6), so the first file (`activity.e2e.ts`) got its pair at 136 to 272 s, after the first call ends at about 104 s; after the first pair, the working tree took 2 to 4 turns in a row in 4 sessions.

- When one side takes the shared group slot and the other side has files of the same request queued, it runs first the earliest file in the request's order that the other side has a result or a run for and it has not, so the first compared file is the first file the leader ran.
- Keep the turns alternating while both sides have matching queued files: a side does not take the slot twice in a row while the other side waits for it with a matching file. No preemption; a side alone still runs at full pace; a partner that is gone or has nothing matching never makes a side wait (023-78's rules stay).
- Record why a side waits: the group slot (with its holder, as 023-77) or the shared worker pool, so the call and the hook stop saying "whether the group's slot or the shared worker pool holds it is not known" when the daemon knows.
- Tests: two daemons, one slot, three requested files, the commit side starting first: the first pair is the commit side's first file; turns alternate; a side alone runs at full pace; the wait reason reads slot or pool.

## Row 023-84 (AA4): a named file behind its own stale run

Round 11 s1b-03 at 312 s: "1 of 1 queued at d8abcfe46, waiting for the browser group's run of packages/web/e2e/thread-scroll.e2e.ts to end", while that run of the same file was at a key the request no longer held.

- When the run a named file waits for is the same file's run at an older key on the same side, say so: "the commit worktree's run of thread-scroll.e2e.ts started before its inputs changed; its result will not count; the file runs again after it" (with about N s when a stored duration exists). Claim only what the daemon records.
- Test: a run at key K; the key moves to K' during the run; the narrowed call reads that line; a run at the current key reads as today.

## Ownership

`src/core/scheduler/**`, `src/core/slow/**`, `src/core/daemon/**`, `src/cli/status-at-estimate*.ts`, `src/cli/status-at-report*.ts`, `src/core/state/**`, `src/core/delivery/**` text, tests beside them.

## Done when

Tests fail without each fix; lint, typecheck, check:private; `squeal status --wait 60000 <changed paths>`; run `test/cli/status-at*.test.ts`, the slot and scheduler tests you touch, `test/keys/key-format.test.ts` directly. Notes in `tasks/023-83-notes.md` and `tasks/023-84-notes.md`.
