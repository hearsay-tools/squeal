# Spec 019 wave 4: proof, and the last small fixes

Two rows in parallel on disjoint files, from main at 0.1.398. 019-27 is a product row and lands through a candidate and review. 019-17's end-to-end test lands with it; its dogfood report is docs.

## 019-17 proof: three groups end to end, and a dogfood

Use /worker. Shape: finish, dogfood. Two parts, in order.

**Part A, the end-to-end test.** `test/e2e/run-triggers.test.ts` (and helpers under `test/e2e/`): a fixture repository with `checks` = unit (Vitest, `edit`), lint (`lint: true`, `commit`), e2e (Vitest project, `stop`, `after: ["unit"]`, `limits.maxParallel: 1`), driven through the built plugin's hook entries (Claude Code and Codex) as the existing `test/e2e/` tests drive them, with no model. Show: an edit runs unit only; a commit runs lint and reports once, then updates once; Stop starts e2e, waits, and holds at most `stop.maxHolds` times in a turn; `squeal run e2e --wait` gives the verdict; the same repository without `checks` behaves as 0.1.393 did (texts and Stop). `test/e2e/**` is outside Squeal's own coverage, so run it directly.

**Part B, the dogfood.** `lessons.md` (create it) gains "Round 1 (019-17)", answering spec open questions 4 (partial staging) and 6 (does a Claude Code Stop fire after an interrupt), measuring open question 7 and row 019-19 (daemon memory over the session with a lane per group), and judging Goals 1 to 6 with evidence from real agent sessions.

- **Isolation.** The OS user `squeal-e2e` as in 017's `tasks/wave-3.md` 017-13 ("Isolation"): `sudo -n -u squeal-e2e -H env -i HOME=/home/squeal-e2e PATH=... <cmd>`, cwd `/`, credentials by name only. Install Squeal from main's `4163f5de8` (0.1.398, unreleased) by `git archive` for that user's Claude Code and Codex.
- **Repositories.** A `git bundle` copy of cezarion (`/home/agent/projects/cezar`; read-only on the original; its e2e browser project at `stop`, its unit projects at `edit`, lint at `commit`), and the Part A fixture.
- **Sessions.** Six `claude -p --model sonnet` sessions, each a real small task: (1) an edit that breaks a unit test; (2) a task whose Stop waits for e2e (with `stop.maxHolds` 1, then 2); (3) a commit that adds a lint finding (the commit line, then its update); (4) a task where the agent should use `squeal run <group>`; (5) the same task as (1) with no `checks` (control); (6) an interrupt (Esc is not available in `-p`: probe whether a Stop follows a killed or interrupted turn some other way, or say it cannot be shown). One Codex session (`gpt-6-astra`) for case (2), with the `stop-slow` hook trusted again.
- **Load.** Start each session only when the one-minute load is at or below 24, and record the load.
- **Record per session:** every SQUEAL line about groups, Stop or commits; the agent's next action; whether the line was right; the time from the moment to the verdict; the daemon's RSS and heap at the start and the end.
- **Rules.** Write only under `/home/squeal-e2e`, `/tmp/dogfood-019-17/`, `test/e2e/run-triggers*`, `lessons.md` and `tasks/019-17/`. Change no product code. Each defect becomes a proposed row in `lessons.md` with its reproduction. Stop every daemon you started and show that none is left.

Done when: Part A passes three times in a row and is committed; `lessons.md` Round 1 is committed with every session's record, the answers, the memory numbers and the proposed rows.

## 019-27 the last small fixes

Use /worker. Shape: repair. Four items, a test each:

1. The skill's `commands.md` says Stop "holds the agent once"; with `stop.maxHolds` it reads as the policy reference does (`plugins/claude-code/skills/squeal/references/commands.md`; source only, the copies are built).
2. `squeal retry` and the outstanding-checks list read a configured group's file as slow (`src/core/retry/*`, `src/core/status/outstanding.ts`, `tasks/019-16/notes.md`): word it by group and its run command.
3. A `normal` commit group's queued files that no commit asked for count as busy for `#normalIdle` (`src/core/scheduler/scheduler.ts`; `tasks/019-26/notes.md` known limit): count only work that may run now, so a `low` group keeps its width.
4. `SlowTier.next` (`src/core/scheduler/slow-tier.ts`) is 27 against the complexity limit of 20: split it without a behaviour change.

Owns those files and their tests. Leave `test/e2e/` to 019-17. Done when: a test per item 1 to 3, the slow-tier tests unchanged and passing for item 4, golden no-`checks` texts unchanged; `squeal status --wait` on changed paths (report pending as pending); lint and typecheck. No build.
