# Wave 2: Spec 025 Performance improvements (rows 025-06 to 025-09)

Baseline: `cez/0266d2c5` commit containing Spec 025 D6–D9 and this brief.
Coordinator: `0266d2c5` (owns version bump, `pnpm run build` / `plugins/*/dist/`, and `docs/board.md`).

## Rules for every worker in Wave 2

1. Read `docs/specifications/025-performance/spec.md` (D6–D9) and `docs/styleguide.md`.
2. Edit ONLY the files listed under your row's **Owned files** (plus new or updated test files for your row and your row notes file). If an unowned file must change, stop and ask the coordinator.
3. Do NOT run `pnpm run build` or modify `plugins/*/dist/`. The coordinator builds bundles once on integration.
4. Do NOT bump `package.json`, do NOT edit `docs/board.md`, and do NOT run the full Vitest suite.
5. Verify with:
   - `squeal status --wait 60000 <changed-paths>` (or if Squeal is unavailable or doubtful, targeted `pnpm exec vitest run --maxWorkers=2 <relevant-test-files>` and state why),
   - `pnpm run typecheck`,
   - `pnpm run lint`,
   - `pnpm run check:private`.
6. Stop any daemon your checks started. Never commit absolute home paths or private names.
7. Commit all changes cleanly on your branch and write concise verification notes in `docs/specifications/025-performance/tasks/<row>-notes.md`.

---

## Row 025-06: D6 - SQLite hot-read optimizations

**Shape:** slice. Use `/worker`.

**Outcome:** Remove the 67k-row complexity scan in `codeStatusOf`, turn `relevantStates` into a `UNION` of three indexed lookups with an additive partial index, avoid no-op write leases for unregistered consumers in `resumeTurn`, and fix quadratic array copying in `checksByFile`.

**Spec:** `docs/specifications/025-performance/spec.md` D6.

**Starting seam:**
- `src/core/code/store/schema.ts` (`CODE_INDEXES`, add `states_non_pass`) and `src/core/code/store/states.ts` (`countNonPass` following `STATES_FAILING` / `indexesIn`).
- `src/core/status/code-status.ts:45` (replace `code.states.list(worktreeId, { measure: "complexity" })`).
- `src/core/store/schema.ts` (`STORE_INDEXES`, add `known_states_non_pass`) and `src/core/store/view-seed.ts:103` (rewrite `relevantStates`).
- `src/core/delivery/turn.ts:127` (`resumeTurn`) and `src/core/status/unknown-files.ts:55` (`checksByFile`).

**Owned files:**
- `src/core/code/store/schema.ts`
- `src/core/code/store/states.ts`
- `src/core/code/store/types.ts`
- `src/core/status/code-status.ts`
- `src/core/store/schema.ts`
- `src/core/store/view-seed.ts`
- `src/core/delivery/turn.ts`
- `src/core/status/unknown-files.ts`
- Tests: new/updated tests under `test/code/`, `test/store/`, `test/status/`, `test/delivery/`.
- Notes: `docs/specifications/025-performance/tasks/025-06-notes.md`.

**Leave alone (sibling-owned):** `plugins/`, `src/harness/`, `src/core/daemon/`, `src/core/runner-host/`, `src/runners/`, `bench/`.

**Requirements:**
1. Never raise `SCHEMA_VERSION`, `CODE_SCHEMA_VERSION`, `KEY_FORMAT_VERSION`, or `RECORDER_VERSION`.
2. In `CODE_INDEXES`, add `states_non_pass: "CREATE INDEX states_non_pass ON states (worktree_id, measure, outcome) WHERE outcome != 'pass'"`. Add `countNonPass(worktreeId, measure)` on `CodeStateRepo` returning `{ fail, pending, unknown }` (using `INDEXED BY states_non_pass` only when `sqlite_master` has it, else falling back cleanly without `INDEXED BY` for read-only/older stores). Use it in `codeStatusOf`.
3. In `STORE_INDEXES`, add `known_states_non_pass: "CREATE INDEX known_states_non_pass ON known_states (worktree_id, check_id) WHERE outcome != 'pass'"`. Rewrite `relevantStates` as the `UNION` of three indexed lookups (`known_states` non-pass using `INDEXED BY known_states_non_pass` when present, `consumer_views`, `state_born`), `CROSS JOIN known_states` and `JOIN checks`, preserving exact row set and `ORDER BY c.project, c.test_path, c.kind, c.full_name`. Confirm `EXPLAIN QUERY PLAN` uses the partial index when present and falls back cleanly when absent.
4. In `resumeTurn`, check `store.consumers.get(consumer) === null` before `store.transaction()`.
5. In `checksByFile`, mutate the per-file array with `.push(state)` instead of spreading on every element.

**Done when:** Targeted unit/property tests pass (including `test/store/view-seed.test.ts`, `test/delivery/narrow-delivery.test.ts`, `test/status/code-status*.test.ts`, `test/delivery/turn*.test.ts`, `test/keys/key-format.test.ts`), `EXPLAIN QUERY PLAN` verifies indexed plans, and typecheck/lint/check:private pass. Benchmark comparison on integration: `@hooks`.

---

## Row 025-07: D7 - Hook and CLI startup (`NODE_USE_ENV_PROXY` carry/restore + `NODE_COMPILE_CACHE`)

**Shape:** slice. Use `/worker`.

**Outcome:** Cut hook and CLI startup time by porting OpenCode's `NODE_USE_ENV_PROXY` carry-and-restore pattern and enabling `NODE_COMPILE_CACHE` in launchers and the Codex fixed adapter without leaking Squeal's compile cache into user test runs or touching Codex `hooks.json`.

**Spec:** `docs/specifications/025-performance/spec.md` D7.

**Starting seam:**
- Reference `src/harness/opencode/bridge-client.ts:36-62` for the `NODE_USE_ENV_PROXY` / `SQUEAL_CARRIED_NODE_USE_ENV_PROXY` carry-and-restore contract.
- `plugins/claude-code/hooks/run`, `plugins/antigravity/hooks/run`, `plugins/claude-code/bin/squeal`, `plugins/opencode/bin/squeal`, `plugins/claude-code/bin/squeal-launcher`.
- `src/harness/codex/adapter/index.ts` (enable compile cache in JS before `await load(runtime.root)`).
- Test-runner env preparation (`src/core/runner-host/channel.ts`, `src/runners/vitest/`, `src/runners/node-test/run/run.ts`, `src/runners/pytest/run/`).

**Owned files:**
- `plugins/claude-code/hooks/run`
- `plugins/antigravity/hooks/run`
- `plugins/claude-code/bin/squeal`
- `plugins/opencode/bin/squeal`
- `plugins/claude-code/bin/squeal-launcher`
- `src/harness/codex/adapter/index.ts`
- `src/core/env/compile-cache.ts` (new small shared helper for stripping Squeal's own compile cache before user tests, or similar module under `src/core/`)
- `src/runners/vitest/observe.ts` / `src/runners/vitest/adapter.ts` (only the minimal env-strip wiring where Vitest workers inherit env)
- `src/runners/node-test/run/run.ts` (strip Squeal's own compile cache from child env)
- `src/runners/pytest/run/run.ts` (or equivalent pytest spawn env file, strip Squeal's own compile cache)
- Tests: new/updated tests under `test/cli/`, `test/harness/`, `test/runners/` (including updating `# squeal-launcher format 9` -> `10` where exact format is asserted).
- Notes: `docs/specifications/025-performance/tasks/025-07-notes.md`.

**Leave alone (sibling-owned):** `plugins/codex/hooks/hooks.json` (NEVER edit — forces Codex hook re-trust), `plugins/*/dist/`, `src/core/store/`, `src/core/code/`, `src/core/status/`, `src/core/delivery/`, `src/core/daemon/`, `bench/`.

**Requirements:**
1. **POSIX `sh` strictness:** Every shell script (`hooks/run`, `bin/squeal`, `squeal-launcher`) must stay POSIX `/bin/sh` compatible (dash and bash) with zero quoting bugs on paths containing spaces.
2. **`NODE_USE_ENV_PROXY` carry/restore:** When `NODE_USE_ENV_PROXY` is set, unset it for the hook/CLI Node start, export `SQUEAL_CARRIED_NODE_USE_ENV_PROXY`, and inject a space-free `--import data:text/javascript,process.env.NODE_USE_ENV_PROXY=process.env.SQUEAL_CARRIED_NODE_USE_ENV_PROXY;Reflect.deleteProperty(process.env,'SQUEAL_CARRIED_NODE_USE_ENV_PROXY')` right after `node` (verify in a test that `node` boots without proxy init AND `process.env.NODE_USE_ENV_PROXY` is restored inside the script and in spawned daemons/children, and `SQUEAL_CARRIED_NODE_USE_ENV_PROXY` is deleted). Do not inject `--import` if the command is not `node` or if `NODE_USE_ENV_PROXY` is unset.
3. **`NODE_COMPILE_CACHE`:** When `NODE_COMPILE_CACHE` is unset (and `$HOME` or `$XDG_CACHE_HOME` is non-empty), export `NODE_COMPILE_CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/squeal/compile-cache"` and `SQUEAL_OWN_COMPILE_CACHE=1` (creating the directory with `0700` permissions best-effort, never failing a hook if unwritable). Never overwrite a user-provided `NODE_COMPILE_CACHE`.
4. **Bump `# squeal-launcher format 9` to `# squeal-launcher format 10`** in `plugins/claude-code/bin/squeal-launcher` and update exact-format assertions in `test/cli/launcher-antigravity.test.ts` (and any other test that pins format 9).
5. **Codex fixed adapter:** In `src/harness/codex/adapter/index.ts`, when `env.NODE_COMPILE_CACHE` is unset, call `enableCompileCache(...)` from `node:module` (guarded with `typeof enableCompileCache === "function"` and `try/catch`) before `await load(runtime.root)`. Do NOT touch `plugins/codex/hooks/hooks.json`.
6. **Strip Squeal's own compile cache from user test runs:** When `SQUEAL_OWN_COMPILE_CACHE === "1"`, remove `NODE_COMPILE_CACHE` and `SQUEAL_OWN_COMPILE_CACHE` from the environment passed to user test runners (Vitest, `node:test`, `pytest`), while preserving any user-supplied `NODE_COMPILE_CACHE` (when `SQUEAL_OWN_COMPILE_CACHE` is not `"1"`). Verify `test/keys/key-format.test.ts` still passes without bumping `KEY_FORMAT_VERSION`!

**Done when:** Tests prove: (a) `hooks/run`, `bin/squeal`, and `squeal-launcher` carry/restore `NODE_USE_ENV_PROXY` and set `NODE_COMPILE_CACHE` + `SQUEAL_OWN_COMPILE_CACHE=1` without breaking user-set cache or spaces in paths; (b) Codex adapter enables compile cache before loading runtime without touching `hooks.json`; (c) user test runners do not inherit Squeal's own `NODE_COMPILE_CACHE` while preserving a user-set one; (d) `test/keys/key-format.test.ts`, launcher/hook tests, typecheck, lint, and `check:private` pass. Benchmark comparison on integration: `@hooks`.

---

## Row 025-08: D8 - Benchmark accuracy and visibility

**Shape:** slice. Use `/worker`.

**Outcome:** Fix the `wt-3`/`wt-6` idle-window measurement bug in `bench/run-cell.mjs`, score whole-tree RSS, report hook p99/max and hook write-wait metrics, and add a real-repo-scale cell option.

**Spec:** `docs/specifications/025-performance/spec.md` D8.

**Starting seam:**
- `bench/run-cell.mjs:220-260` (`startOthers` -> `idle`) and `bench/run-cell.mjs:350-385` (log collection).
- `bench/summarize.mjs:522-585` (`hookValues`, `resourceValues`, metric specs/thresholds).
- `bench/lib.mjs:220-260` (log parsers), `bench/run-all.mjs`, `bench/gen-project.mjs`, `bench/README.md`.

**Owned files:**
- `bench/run-cell.mjs`
- `bench/summarize.mjs`
- `bench/lib.mjs`
- `bench/run-all.mjs`
- `bench/gen-project.mjs`
- `bench/README.md`
- Tests: `test/bench/summarize.test.ts` (new, testing summary/log parsers and backward compatibility on historical `cell.json` files under `bench/results/`).
- Notes: `docs/specifications/025-performance/tasks/025-08-notes.md`.

**Leave alone (sibling-owned):** Everything under `src/` and `plugins/`, and existing `bench/results/*` artifacts (read-only).

**Requirements:**
1. **Fix `wt-3`/`wt-6` idle window in `bench/run-cell.mjs`:** After `startOthers`, wait for every secondary worktree daemon to finish its initial startup baseline (e.g. `squeal status --wait 60000` or polling `status --json` until `testFilesListed === true`, `counts.pending === 0`, `testFilesWithoutChecks.pending === 0`, and `code.pending === 0` if `code` is present, with a bounded timeout and recording the settle wait in `cell.phases.startOthers`) BEFORE reading `idle0`/`idleStore0` and sleeping for `idle`. Do not regress single-worktree cells.
2. **Whole-tree memory (`res.treeRss.max`):** Add `res.treeRss.max` (from `cell.daemonRss.maxTreeBytes / 2**20`) to `bench/summarize.mjs` and `bench/README.md` (scored under Resources with clear healthy/warn limits documented in `bench/README.md`, e.g. healthy <= 750 MiB, warn <= 1500 MiB for 1-wt or per-worktree `maxTreeBytes / worktrees`, or clearly documented per-worktree tree RSS so `wt-3`/`wt-6` are fair — check how `res.daemonRss.max` handles `wt-3` vs `ref` and match its style cleanly!).
3. **Hook tail metrics:** Report `hook.preToolUse.p99`, `hook.preToolUse.max`, `hook.postToolBatch.p99`, and `hook.postToolBatch.max` as report metrics in `bench/summarize.mjs`.
4. **Hook write-wait log parsing:** Add a parser in `bench/lib.mjs` for daemon log lines emitted by D9 (`long write wait: hook write waited <N> ms ...` and `hook writes: <n> taken, queue wait p95 <p95> ms max <max> ms`), collect them in `bench/run-cell.mjs`, and report `hook.writeWait.p95`, `hook.writeWait.max`, and `hook.longWriteWaits` in `bench/summarize.mjs` (yielding `null` / `n/a` cleanly for older Squeal versions without those log lines).
5. **Real-repo-scale cell option:** Support a `cases` / `functions` multiplier (or `--checks-per-file` / extra helper functions) in `bench/gen-project.mjs` and add an opt-in cell (e.g. `scale-real`, ~2,000 test files with ~10 cases/file and ~30 functions/file -> ~20k checks and ~60k functions) in `bench/run-all.mjs` (outside the default cell list if it takes long, or in a named group like `@scale`, documented in `bench/README.md`).
6. **Backward compatibility:** Verify `bench/summarize.mjs` still summarizes an existing `bench/results/2026-11-24-0.1.615-vs-0.1.616-default-AMD-Ryzen-7-9700X-8-Core-Processor` directory without crashing (test in a temp copy or via unit test). Do NOT run `bench/boat-run.sh` on this host (`AGENTS.md`: bench runs only on boat.dev).

**Done when:** Unit tests in `test/bench/summarize.test.ts` cover idle-settle logic/helpers, `maxTreeBytes` scoring, hook p99/max, hook write-wait log parsing, `scale-real` generation, and backward-compatible summarization of existing `bench/results/` data; `node --check` passes on all edited `.mjs` files; typecheck, lint, and `check:private` pass.

---

## Row 025-09: D9 - Daemon front-desk hook write-wait instrumentation

**Shape:** slice. Use `/worker`.

**Outcome:** Measure and log how long each hook's `write` batch waits in the front-desk-to-main-thread queue, logging waits over 250 ms and periodic/shutdown summaries in the daemon log.

**Spec:** `docs/specifications/025-performance/spec.md` D9.

**Starting seam:**
- `src/core/daemon/desk-messages.ts` (`FromDesk` `"write"` variant).
- `src/core/daemon/front-desk.ts:144-149` (`requestWrite`).
- `src/core/daemon/desk.ts:399-409` (`case "write":`).
- `src/core/daemon/daemon.ts` (periodic/shutdown stats log, matching `store-process/stats.ts` / `code store: last minute:` style).

**Owned files:**
- `src/core/daemon/desk-messages.ts`
- `src/core/daemon/front-desk.ts`
- `src/core/daemon/desk.ts`
- `src/core/daemon/write-wait.ts` (new small stats collector module if helpful)
- `src/core/daemon/daemon.ts`
- Tests: `test/daemon/write-wait.test.ts` (new) and updates to directly related desk/daemon tests if needed.
- Notes: `docs/specifications/025-performance/tasks/025-09-notes.md`.

**Leave alone (sibling-owned):** `src/core/store/`, `src/core/code/`, `src/core/status/`, `src/core/delivery/`, `plugins/`, `src/harness/`, `src/runners/`, `bench/`.

**Requirements:**
1. Add `queuedAt: EpochMs` to the `"write"` message in `src/core/daemon/desk-messages.ts`, stamped with `Date.now()` in `src/core/daemon/front-desk.ts` when posting `{ type: "write", id, batch, queuedAt }`.
2. On the main thread in `src/core/daemon/desk.ts`, compute `waitMs = Math.max(0, Date.now() - message.queuedAt)` immediately upon receiving `case "write"` (before invoking `events.requestWrite`), and pass it to an optional callback `onWriteWait?: (waitMs: number) => void` on `DeskEvents`. (In `inThread` mode, `waitMs` is `0` or omitted cleanly.)
3. Add a lightweight `WriteWaitStats` tracker (`src/core/daemon/write-wait.ts`):
   - Threshold `LONG_WRITE_WAIT_MS = 250`.
   - When `waitMs > LONG_WRITE_WAIT_MS`, log via the daemon logger: `long write wait: hook write waited ${Math.round(waitMs)} ms for the daemon main thread`.
   - Track bounded wait samples (e.g. cap in-memory sample ring per minute to avoid unbounded memory) and expose `take(): string | null` returning `hook writes: ${count} taken, queue wait p95 ${p95} ms max ${max} ms` (or `null` when `count === 0`).
4. Wire `WriteWaitStats` in `src/core/daemon/daemon.ts`: log `take()` every 60 s (unref'd timer, matching the code-store summary cadence) and once on daemon shutdown if non-null, clearing the timer on shutdown.
5. Keep the log format exact so `025-08`'s `bench/lib.mjs` parser matches both lines verbatim:
   - `long write wait: hook write waited <int> ms for the daemon main thread`
   - `hook writes: <int> taken, queue wait p95 <int> ms max <int> ms`

**Done when:** `test/daemon/write-wait.test.ts` tests `WriteWaitStats` (threshold > 250 ms logging, p95/max summary formatting, sample cap, reset on `take()`) and a real/worker front-desk test verifies `queuedAt` -> `onWriteWait` triggers under a simulated main-thread block; existing `test/daemon/desk*.test.ts` / `front-desk*.test.ts` pass; typecheck, lint, and `check:private` pass. Benchmark comparison on integration: `@hooks`.
