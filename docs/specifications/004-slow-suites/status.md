# 004 Slow suites by policy: status

Stage: approved (2026-10-08, by the human; waves on `docs/board.md`, briefs under `tasks/`)
Started: 2026-10-08

## Decisions so far

- The human named e2e tests as one of three blockers on 2026-10-07 (ADR 0004). Spec 004 is how Squeal validates suites too slow to run on every revision: end-to-end, integration and package suites such as this repository's `test/e2e` (Vitest, about a minute) and cezarion's `test:package` (node:test, `test/e2e/*.test.ts`).
- The promise holds as for 003: only what is needed runs, only the delta reaches the agent, and a slow result is never reported as current for code it did not run against.
- Both runners stay: a slow suite is a Vitest project or a node:test project marked slow by policy, not a new runner.
- Lessons already in hand: e2e suites read state outside the worktree's files (`git archive HEAD`, installed plugins, spawned processes), so their keys miss inputs (002 `lessons.md` defect 5, board row 002-24); they compete for CPU with the agent and with each other, and timing tests fail under load (this repository's load reached 127 on 2026-10-08); a run interrupted by an install must store nothing (001-107, 001-113).

## Amendments after approval

- 2026-10-08, decided by the human at approval: a slow result is inherited only when its declared inputs name the artifact it tests (D6, goal 5; no `slow.inherit` key). Key shape by the coordinator, on the human's request for a recommendation: one `slow` object (`include`, `maxWorkers`, `maxLoadPerCpu`, `maxDeferMs`), as the existing `stop`, `runner`, `daemon` and `store` groups are (D1, D7).

- 2026-10-08, wave 0 (004-10, 004-11), 0.1.42: the `slow` object, `nodeTest[].slow` and `stop.requireSlowSuite` in the policy and its loader, `slowFiles(policy, projects).isSlow`; the slot is an exclusive SQLite lock on `/tmp/squeal-<uid>/slow.lock` (freed when its holder dies, so no pid is read back), and the guard returns the load per CPU it ran under at the bound and treats a load exactly at the threshold as within it. The scheduler carries the guard's remaining budget per slow pass (004-12).

- 2026-10-08, 004-13: `squeal run --slow` reaches the scheduler through a `run-slow` request, but a slow node:test file's spawned CLI is not observed (`tasks/004-13/notes.md`): the recorder is only in argv, 001-132's recorder is never given to node:test, and a child's loads would be counted as preloads. D5's recorder sentence stands; it is built by new row 004-19, dispatched with 003-37 as one worker since both change the same attribution. Both wave-1 workers were cancelled by a coordinator session restart at 23:22; 004-13 had committed everything and was verified by the coordinator; 004-12 is finished by a second worker from its commits.

## Research

Complete 2026-10-08: `research/slow-suite-policy.md` (Opus), `research/slow-suite-runtime.md` (Astra). Every question tagged; measurements at load 5 to 36 on this shared host, none at calm load. The spec is written from these files.

## Open questions

See `spec.md`, section Open questions.

## Links

- Vision: `../../vision.md`
- ADR: `../../decisions/0004-codex-and-node-test-next.md`
- Specs 001 (D5 scheduler, D11 policy), 002 (Stop and harness checkpoints), 003 (node:test projects).
