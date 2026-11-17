# 005 wave 23: a daemon stopped during its start; quality scan of the hook-message rows

Coordinator: session 4d2ecbfc. The human chose both on 2026-11-17 (card after the 0.1.548 landing). Two workers, disjoint.

Rules for both: no `pnpm run build` in your worktree, no version raise, no full suite. Read Squeal's verdict on your changed paths before you report (`squeal status --wait 60000 <path>...`). Run a Vitest file directly only where Squeal does not cover it, one file at a time, with `timeout 900`. Write `~`, never a `/home/<user>/` path; the private-material check (`pnpm run check:private`) also rejects the company name and local project folder names.

## W1: 005-111, a daemon stopped during its start is not told as a slow start

Use /worker. Shape: slice. Outcome: when the process that holds the worktree's lock and start mark is stopped (job-control stop, `/proc/<pid>/stat` state `T` or `t`) and has not registered, the session is not told "a daemon is still starting" without end. It reads the same class of sentence a registered stopped daemon gives today: the daemon may be stopped, with the time of its start mark, and no `squeal start` advice.

Evidence: `tasks/005-108/notes.md`, the paragraph "A daemon SIGSTOPped inside its start": the state reads as starting, then the one "still starting" message at 60 s. 005-108 left it open because `lifeOf` (`src/core/daemon/terminate.ts:160`) does not report the state letter and that file was outside its ownership. The presence side reads the lock holder through `src/core/presence/lock-events.ts:109` and `src/core/presence/marks.ts:135`.

Contract:
- Linux only reads the state; another platform keeps today's behaviour, stated in a test.
- A process that is running or sleeping during a slow start reads as today (starting, one message past `DAEMON_START_SLOW_MS`).
- A stopped starting process: one message, at the first boundary that sees it stopped, not repeated while the state holds; when the process continues and registers, the normal path follows with no leftover notice. Say in your notes what Stop and `squeal status` print in that state and make them agree with the hook.
- No hook spawns a second daemon while the stopped process holds the lock (005-108's rule holds).
- The sentence carries only what the agent can act on (the human's rule of 2026-11-16): what is known, since when, that results do not move until it runs again. No pid in the hook text; `squeal ps` already has it.

Owns: `src/core/daemon/terminate.ts` (the `Life` type and `lifeOf` only: add the state, change no caller's behaviour), `src/core/presence/{marks,lock-events,heartbeat,views,findings,facts,decide}.ts`, the text for this state in `src/core/delivery/{format,header}.ts`, `src/core/types/status.ts` for the new state, `src/core/status/snapshot.ts` if status needs it, their tests, the evals parsers and skill copies if a sentence is added (grep all of `test/`, also `test/e2e/**` and `evals/**`, for every sentence you change). Leave alone: the rest of `src/core/daemon/**`, `src/core/store/**`, `src/harness/pi/**`, `src/harness/opencode/**`.

Done when: a test with an injected process-state reader for each of: stopped while starting (the new sentence, once), running while starting (as today), stopped then continued (no leftover), not Linux (as today); one test with a real child process that is SIGSTOPped, read through the real `lifeOf`, skipped off Linux; the texts before and after in `tasks/005-111/notes.md`.

Final message: the commit, each state's text before and after, check results with their commands.

## W2: 005-112, quality scan of rows 005-89 to 005-109 and 011-391

Use /quality. Read-only: you change no code, no board, no spec. Stretch: `cbacefe9f..164b30138` on main, limited to the commits of rows 005-89 to 005-109, 011-391 and 009-30 (the release commits `release: 0.1.525` to `release: 0.1.548` whose subject names one of those rows, and the commits between them that touch the directories below). Other coordinators' rows in that range (spec 023, the scheduler, the private-material work) are out of scope.

Directories the stretch touched: `src/harness/shared`, `src/harness/pi`, `src/harness/opencode`, `src/core/delivery`, `src/core/presence`, `src/core/store` (`view-seed`, `state-born`, `open`, `schema`), `src/core/daemon` (`open`, `lifecycle`, `full-check`, `store-fault`, `store-file`), `src/core/status/snapshot.ts`, their tests, `test/helpers/pi-wake-trace*`.

Look in particular for, and judge each against `docs/vision.md` (also its paragraph "Silence has to stay readable") and `docs/styleguide.md`:
- a sentence, time format or header rule the hooks state in two places (`format.ts`, `header.ts`, `late.ts`, the harness copies, the evals parsers, the skill text);
- the registration paths of the four harnesses (Claude Code, Codex, Pi, OpenCode) after 0.1.541, 0.1.542 and 0.1.546: the "registration text sent" mark was repaired three times; is there one owner of that rule, or three copies;
- the view after 0.1.548: code that only served the full copy and is dead now (`view-seed`, the one-statement copy of 0.1.545's row 005-103, readers that still assume a row per state);
- the store check after 0.1.545: leftovers of the start-time `quick_check`;
- presence after 0.1.547 and 0.1.548 (`facts`, `decide`, `views`, `findings`, `heartbeat`, `narrow`): two modules that decide the same state;
- anything in a hook message that only serves debugging by the person, not an action of the in-session agent (the human's rule of 2026-11-16; `research/hook-messages-2026-11-16.md` is the review this work came from);
- tests that only restate another; a module past about 300 lines.

Write `docs/specifications/005-agent-adoption/quality/2026-11.md` and commit that file alone. Each finding names file and line and is exactly one of: a drop candidate with the vision clause it fails, a board row in the board's column shape with a one-worker scope, or one small slice in a sentence.

Final message: the findings path first, then the counts.
