# 005 wave 26: one next step when test files are not listed; the dead-daemon text; hook readers of a starting daemon

Rows 005-114, 005-116 and 005-115, from the quality scan `quality/2026-11.md`. The human chose them on 2026-11-17. Coordinator: session 4d2ecbfc. Two workers, disjoint. Baseline: main with 0.1.551 (row 005-111 landed).

Rules for both: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report (`squeal status --wait 60000 <path>...`), but do not wait longer than 20 minutes for a queue under host load: run the test files of the directories you changed directly, one at a time, `timeout 900`, and say which you ran. The bundle tests fail on drift until the coordinator builds, which is expected. `test/e2e/**` is outside Squeal's coverage: grep it, and `evals/**` and the skill copies, for every sentence you change, and run each e2e file that pins one. Write `~`, never a `/home/<user>/` path. Never run a script under `evals/bin`.

## W1: 005-114 and 005-116, hook text

Use /worker. Shape: slice, two commits (one per row).

**005-114.** Board row 005-114 and `quality/2026-11.md`, row `proposed-late-one-owner`, are the scope: read both in full. The human's decision: when test files are not listed yet, or a delay is told, the agent reads ONE next step, and it is to wait with `squeal status --wait 60000 <path>...`. No hook sentence says "run the tests yourself" while a daemon validates. The primer keeps its rule for hand runs (no daemon validates, a result is unknown, or the repository's own gate needs it).
- The late line owns the delay sentence: one message never states the delay twice (header and late line).
- The sentence that sends the agent to a hand run in `src/core/delivery/late-format.ts` goes; say in your notes each place a "run the tests yourself" clause existed and what stands there now. If a state exists where no daemon validates and the late line speaks, that state keeps a hand-run sentence: name it.
- Tests: the unlisted case and the unread case each assert the header's delay sentence is absent when the late line speaks, and the one next step.

**005-116.** Board row 005-116 and `quality/2026-11.md`, drop candidate 1. The human's decision: "Drop run numbers, keep cause". In hooks the dead-daemon text says: the last daemon died without shutting down, the test files it ran, the cause sentence (`DEATH_CAUSE`), `squeal start`. No run id, no revision. `squeal status` and `squeal why` keep the full text.

Owns: `src/core/delivery/{header,late,late-format,format}.ts`, `src/core/status/{feed-late,died}.ts` (a hook form of the death text; the status form stays), their tests, the e2e text files and `evals/lib/squeal-text.mjs` and the skill copies where a sentence changes. Leave alone: `src/core/presence/**`, `src/core/delivery/{delivery,delta,counts-owed,view-mark,sending-connection}.ts` (rows in review), `src/harness/shared/stop*.ts` and `deny.ts` (W2).

Done when: the tests above; texts before and after for every changed sentence in `tasks/005-114/notes.md` and `tasks/005-116/notes.md`; the evals parser gate on the real formatters still passes (`test/evals`).

Final message: the two commits, each changed sentence before and after, check results.

## W2: 005-115, every hook reads a starting daemon as delivery does

Use /worker. Shape: repair, failing test first. Board row 005-115 and `quality/2026-11.md`, row `proposed-hook-readers-commondir`, are the scope: read both in full. The claim is unverified: first write the test (a worktree with no worktree row whose daemon holds the lock and the start mark; a Stop, a Stop-required read and a deny read) and show what each says on main. If they already read "starting", stop and report.

Then: `readLiveHeader` (`src/core/delivery/liveness.ts`) takes one options object with a required `commonDir`; all six callers pass it. Behaviour question, decided by the coordinator: a slow Stop wait does not end as "daemon down" after `STOP_SLOW_DOWN_MS` while a start mark names a live, running process; a stopped starting process (row 005-111, `startStopped`) and a dead one end the wait as today.

Owns: `src/core/delivery/liveness.ts` (`readLiveHeader` and its callers' arguments in `delivery.ts`: the two call sites only), `src/harness/shared/{stop-slow,stop-decide,stop-required,deny}.ts`, their tests. Leave alone: the rest of `delivery.ts`, `src/harness/shared/{stop,stop-states}.ts` (row 005-124, in review), `src/core/presence/**` beyond reading it, hook text (W1).

Done when: the failing tests pass; a slow Stop during a held start waits on (clock injected, no real sleep past a second); every existing Stop and deny test passes unchanged; notes in `tasks/005-115/notes.md`.

Final message: what each reader said before and after, the commit, check results.

## Review brief: candidate 0.1.554

Use /reviewer. Candidate `cand/0.1.554`, three rows from the quality scan. Review the range `origin/main..cand/0.1.554` at the SHA your task names; the last commit is the version raise with the built bundles (CI checks the bundles against the build: do not review bundle text). Contracts: sections W1 and W2 above; the workers' notes are `tasks/005-114/notes.md`, `tasks/005-116/notes.md`, `tasks/005-115/notes.md`.

Check in particular:
- **005-114.** The human's decision: when a result is late or test files are not listed, the agent reads one next step, the path wait (`squeal status --wait 60000 <path>...`); no hook sentence sends it to a hand run while a daemon validates. Find any state where a message still states the delay twice (header and late line), states none when one is due, or names two next steps. Is the path wait true in each state it is named (does it wait for the listing; for unread edits)? Is there a state where no daemon validates and the late line speaks with no hand-run sentence? The primer's rule for hand runs must still be reachable from what the agent reads.
- **005-116.** The human's decision: in hooks the dead-daemon text has no run id and no revision, and keeps the cause sentence; `squeal status` and `squeal why` keep the full text. The worker added no new `squeal start` sentence and no cause sentence on the "Not validated" line: judge both. Several open runs, more than 5 files, no file.
- **005-115.** Stop's decision, the stopped-by-request read, the slow Stop wait and the test-command deny read a row-less worktree's starting daemon as delivery does. The coordinator's decision: a slow Stop wait goes on while a live, running process holds the start, and ends as before for a stopped start (row 005-111), a dead one, and a spawn that never took the lock. Can a Stop now wait to its bound in a state where nothing will come? `readLiveHeader`'s options object: `commonDir` is a required key whose type allows `undefined`; say whether that is acceptable or a should-fix.
- Every sentence changed is followed in `test/`, `test/e2e/**`, `evals/lib/squeal-text.mjs` and the skill copies; the evals parser gate runs the real formatters.
- The three rows together with 0.1.551 (the stopped start) and 0.1.553 (Stop's kept states list): `stop-slow.ts` reads the states in its own process.

Test policy: no full suite. Read CI for `cand/0.1.554` for the full-suite result. Run single test files directly where you need them, one at a time, with `timeout 900`. Never run a script under `evals/bin`. No artificial load.

Write `docs/specifications/005-agent-adoption/reviews/0.1.554.md`: PASS or FAIL first, then blocking findings (B), should-fix (S) and notes (N), each with file and line and a failing scenario.

### Re-review after the repair of B1, B2 and S1

The first review (`reviews/0.1.554.md`) failed at `79d897857` on B1 and B2, with S1. The repairs are the two commits "fix(005-114) B1" and "fix(005-116) B2 + S1" in this candidate; `tasks/005-114/notes.md` has the branch table and `tasks/005-116/notes.md` the death-text cases. Bounded re-review: B1, B2 and S1 are closed, each by a test that fails without the repair; the repairs break nothing the first review passed. Two things the repair added beyond the findings, judge both: no late line is said before the worktree's test files are listed (`lateNotes`), and `src/harness/shared/deliver.ts` passes whether the header told the death, so the "Not validated" line drops its own copy of the command. Row 005-115 is unchanged from the first review. Write `reviews/0.1.554-r2.md`: PASS or FAIL first.
