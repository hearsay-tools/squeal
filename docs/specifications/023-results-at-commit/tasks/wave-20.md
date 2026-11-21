# Wave 20 (rows 023-34 to 023-36): before/after fixes from dogfood round 5. Use /worker.

The human chose (2026-11-21, "All T1-T6"). Read `../lessons.md` "Round 5 (023-33)" (evidence and T1 to T6), `tasks/023-33/` (session logs and judgements), `../spec.md` D3, D4 (step 10 and the new step 11), D6. Never write the lab VM host name or the company name in a committed file. Host is loaded: direct vitest only with `timeout 600 pnpm exec vitest run --maxWorkers=2 <paths>`; no full suite; no version, no build; nothing left running.

## Row 023-34: `--run` gives back what it queued; never-kept files compare; `--at --wait` (T1, T4, T5)

- **T1.** When `--run`'s budget ends, every file this call queued in the worktree's daemon and that has not started is taken back from the daemon's queue, and the report says so ("1331 not run; taken back from the daemon"). A later `--at … <file> --run` that names files puts them ahead of earlier `--run` work. When the selection clearly cannot fit before running (R4's estimate above the cap, or no stored durations and more files than one batch can hold), print R4's line and run nothing until the caller narrows or passes `--all-missing`/`--timeout`; say how to force it.
- **T4.** A selected file that ran on both sides in this call but that the gate did not keep (for example "read paths first seen during the run") is compared from this run's results on both sides, marked "(this run, not stored)". Never stored.
- **T5.** `squeal status --at … --wait` prints one line, exit 2: "`--at` takes no `--wait`; `--run` waits up to `--timeout` (300 s)", not the whole help.
- **Ownership.** `src/cli/status-at*.ts` except the report text files of row 023-35 (`status-at-report*.ts` for the not-selected line: coordinate hunks through the coordinator), `src/cli/main.ts` status --at argument handling. T1 needs the daemon to drop queued work for a request: if that needs a change in the daemon, scheduler or protocol (`src/core/daemon/**`, `src/core/scheduler/**`, `src/protocol/**`), stop and send the coordinator a request with the exact change first; spec 011's coordinator owns those files.
- **Done when:** a test per item that fails on today's code (T1 with a real daemon or the existing daemon test kit); lint, typecheck, check:private, boundaries; `squeal status --wait 60000` on changed paths.

## Row 023-35: what "not selected" means; step 8 timeout (T2, T6)

- **T2.** Files with no result at the commit that the change does not select read: "<n> test files not selected: none of their inputs differs between <commit> and the working tree, so this commit cannot change their result" (with the count of incomplete static closures excepted and `--json` listing them). In the summary line they are counted apart from "unknown". JSON: a stable new field; keep old fields.
- **T6.** Step 8 of the skill, in the three copies that have it (`plugins/claude-code/skills/squeal/SKILL.md`, `plugins/codex-runtime/skills/squeal/SKILL.md`, `plugins/pi/skills/squeal/SKILL.md`): add "give the call a tool timeout above `--timeout`, for example 360 s for the default 300 s". The claude-code copy is 2 characters under its 7,000-character cap: shorten other step-8 words to fit, or raise the cap test with one line of reason; same words in every copy.
- **Ownership.** `src/cli/status-at-report*.ts`, the three SKILL.md copies (step 8 only), the skill cap test if needed, tests beside them.
- **Done when:** as 023-34.

## Row 023-36: processes the working-tree run leaves (T3)

- **Evidence.** In all 10 squawk sessions of round 5, the e2e server and its watcher that `--run`'s working-tree side started (through the daemon, cwd the user's clone) outlived the call and `squeal stop`.
- **Change.** Record the process group of each run the daemon starts for a `--run` request (as the checkout's install is recorded), and stop that group when the run ends or is taken back (T1). `squeal stop` ends any recorded group still alive and names it. Match by recorded group only, never by path or command line (the human's rule of 2026-11-21 for cleanup: no guessing from command lines).
- **Ownership.** This is in the daemon's run path, owned by spec 011's coordinator. Read first; then send the coordinator a request naming the exact files and change before editing. Tests beside the changed files.
- **Done when:** a test where a test file starts a detached child in its own group under a `--run` working-tree run, and the child is gone after the call; a test that `squeal stop` ends a recorded group and names it; a process outside the group survives; lint, typecheck, check:private, boundaries.
