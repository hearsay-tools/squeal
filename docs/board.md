# Board

Current and planned tasks. The coordinator keeps this file; workers do not edit it. One task is one worker, one branch, one result. A wave runs its tasks in parallel and ends with a review whose findings shape the next wave.

Status values: `planned`, `running`, `review`, `done`, `dropped`.

## Feature 001: core validation loop

Spec: `specifications/001-core-loop/spec.md`. Sections referenced as D1 to D12.

### Wave 0: scaffold

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-00 package scaffold and interfaces | done | npm package `squeal`, strict TS, ESM, Node >= 22.13, Vitest for tests, Biome for lint and format, GitHub Actions CI (lint, typecheck, test on Node 22 and 24), source layout `src/core`, `src/runners/vitest`, `src/harness/claude-code`, `src/cli`, `plugins/claude-code`, `test/fixtures`. Internal interfaces from the spec as types with doc comments: watcher backend (D2), runner adapter (D4), store access (D8), harness delivery (D9), policy (D11). No implementations beyond stubs that satisfy the type checker. | CI green on the branch, `npm test` runs one placeholder test, types reviewed by the coordinator. |

### Wave 1: foundations (parallel, after wave 0 review)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-10 shared store | done | D8: `node:sqlite` store at `<common-dir>/squeal/store.sqlite`, schema and `user_version` migrations, WAL and busy timeout, repositories for worktrees, revisions, file hashes, test files, checks, results, runs, transitions, consumers and views; pruning. Common-dir resolution without git (D1). | Concurrency test with 4 writers and 4 readers loses nothing; kill-during-write leaves `integrity_check` ok; migration test from version 0. |
| 001-11 hashing and keys | done | D3: git blob hash with the clean-index shortcut and attribute rule, environment hash, check key, closure assembly from runner output plus snapshot and declared inputs, stat cache, reverse index, incremental re-keying on change, add and delete handling. | Unit tests for every rule; key stability across a worktree copy at another path; 5,000 closures re-keyed under 1 s. |
| 001-12 watcher and revisions | done | D2: watcher interface with chokidar (Linux) and @parcel/watcher (macOS) backends, git-derived ignores in three layers, nested worktree exclusion, debounce 100/500 ms, hash-based reconciliation into revisions, 30 s reconciliation pass. | Fixture tests for atomic save, rename storm, new nested worktree, touch without change (no revision), missed event caught by reconciliation. |
| 001-13 Vitest adapter | done | D4: runner interface implementation over `vitest/node`: invalidate, affected (related walk plus setup, config and snapshot additions), closure, enumerate, run via reporter hooks, file-level errors, config-change recreate, exit code reset. Fixture projects. | Every invalidation case in research Q5 has a test; results come only from reporter hooks; one-file warm run under 400 ms on the fixture. |

### Wave 1.5: review fixes (parallel, from `specifications/001-core-loop/reviews/wave-1.md`)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-14 adapter fixes | done | B1 closure includes absent import targets with resolution candidates and the snapshot path always; S3 `RunnerEnvironment.files` becomes paths only and the core hashes them via the stat cache in `environmentHash`; S7 unattributed unhandled error ends the run as `crashed`; N4 duplicate `fullName` gets a line suffix; N3 adapter errors go to the run log; N1/N7 comments. S9 key-stability test built from real adapter output in a `git worktree add` copy. | Tests for each; a stored closure list re-keyed in a second directory where the import target exists yields a different key. |
| 001-15 keys and revision fixes | done | B2 tri-state hash source (`undefined` = untracked) and `KeyIndex.setClosure` returns untracked paths and refuses to key while any exist; S1 `reconcile` takes a `CandidateBatch`, uses its stats, one `lstat` definition everywhere (symlinks hash as git does, the target path as blob), and is split so append plus stat-cache flush run in one store transaction. One test feeds a real `ChangeFeed` touch batch into `reconcile` and asserts no revision. | Tests for each; no second stat per path. |
| 001-16 store fixes | done | S4 `skip` in `KnownOutcome` and decoders; S5 `KnownStateRepo.removeMany`, `ViewRepo.removeMany`, `ResultRepo.checksForKey`, prune of unreferenced `checks`; S6 `checkpoints` table and repo, `RunRecord.checkpointId`, `lastCompletedCheckpoint(worktree)`; N5 `results.last_used_at` advanced by `byKey` hits and used for eviction. Schema is pre-release: edit v1 in place, no v2. | Round-trip and prune tests updated; every new repo method tested. |
| 001-17 watcher fixes | done | S9 rename storm test; N2 concurrent `lstat` in reconciliation passes; N7 comment. | Tests green; reconciliation pass over 10k paths measured and reported. |
| 001-18 shared helpers | done | S2: one `src/core/fs` module with `runGit({ input, okCodes })`, `splitNul`, `isMissing`, `toRelative`/`toAbsolute`, `compare`; delete every copy; `FileStat` lives in types only. | No duplicate helper remains; all tests green. |

### Wave 2: semantics (parallel, after wave 1.5 lands)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-20 scheduler and validity | done | D5 plus the daemon loop glue and the "Inputs for wave 2" section of `reviews/wave-1.md` (S8 lockfile watching, untracked closure paths, environment refresh, bootstrap re-applying declared inputs): per-check validity, lookup-before-run, ordering, tiers with re-planning, post-tier stability check, baseline lookup then run-missing, `run --all`. | Fixture test: change during a tier discards and re-queues; second worktree bootstrap runs zero tests. |
| 001-21 known state, transitions, delivery views | done | D6: known-state derivation, fingerprint, transition recording, consumer registration with seeded view, delta computation, message formatting with header and 10,000-character cap. | Break-and-recover between deliveries yields silence; first-seen fail, pass to fail, fail to pass, changed fingerprint each yield exactly one delta line. |
| 001-22 status and why | done | D7: `squeal status`, `--json`, `squeal why <check>`, human formatter matching the vision example, daemon liveness from heartbeat. | Snapshot tests of both renderings; works with no daemon running. |

### Wave 2.5: review fixes (parallel, from `specifications/001-core-loop/reviews/wave-2.md`)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-23 scheduler fixes | done | B1 runner failure is a state (`markUnknown` per project, persisted note, never retire on failed listing, unkeyed files included in baseline and `run --all`, checkpoint `abandoned` when any file is unkeyed or unknown); B2 revision atomic with content re-key, `queued` phases and refresh in one transaction, structural changes mark possibly affected files queued; S1 file-level check records `pass` on load; S5 discard guard counts only same-key discards; S6 notes persisted in `meta` (`notes.<worktreeId>`, bounded JSON array of `{at, revision, text}`); S7 scheduler tests through the real `StateSink` plus the three integration tests; S8 `describeFailure` as default; S9 per-file checkpoint attribution; S10 `runner.timeoutMs` default 600000; N2, N3, N8. | Probe scenarios from the review are tests: broken config yields unknown counts and no full-suite claim; mid-tier read shows pending; three edits during three runs deliver nothing spurious. |
| 001-24 semantics fixes | done | S1 delta side: a retired check whose told state was `fail` is delivered once as resolved; S2 `createStatusBuilder(store)` over the store, used by `HarnessDelivery.status`; S3 one header reader, one known-failure mapper, one check formatter with a parser `squeal why` accepts, one check key and one test-file key helper, one validity rule; S4 test-file counts by class in `StatusHeader`, JSON and human renderings; S6 status reads persisted notes; `peek(consumer, { kinds })` on `HarnessDelivery` for PreToolUse; N1 inherited provenance prints the root; N4 field compare; N7 `HEAD` and dirty in status without a revision. | Tests for each; a check name printed in a delta round-trips through `squeal why`; delivery header and status agree on a worktree with no revision. |

### Wave 3: runtime and harness (parallel, after wave 2.5 lands)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-30 daemon and CLI | done | D10, D11 (`squeal daemon`, `squeal start`, `squeal run --all`, `ensureDaemon` for hooks; `squeal init` moves to 001-31) plus the "Inputs for wave 3" section of `reviews/wave-2.md` (worktree registration, start order, socket budget, shutdown): detached start, exclusive-lock singleton, socket in runtime dir, heartbeat, exit conditions, consumer expiry, policy loading from `squeal.config.json`, `squeal daemon`, `squeal start`, `squeal run --all`, `squeal init`. | Five concurrent starts yield one daemon; SIGKILL and restart within 200 ms; idle exit observed in a test with a short interval. |
| 001-31 Claude Code plugin | done | D9 plus the "Inputs for wave 3" section of `reviews/wave-2.md` (peek for PreToolUse, bundling for the 80 ms budget): plugin manifest, `hooks/hooks.json`, dependency-free hook scripts for SessionStart, PostToolBatch, PreToolUse (policy), Stop, SubagentStart, SubagentStop, SessionEnd, the asyncRewake waiter with per-consumer lock and `-p` guard, `skills/squeal`, `bin/squeal`. | Recorded-JSON tests for every event; p95 hook latency under 80 ms; no store and newer-schema cases exit 0 silently. |

### Wave 3.5: review fixes (parallel, from `specifications/001-core-loop/reviews/wave-3.md`)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-32 plugin ships and hooks are honest | done | B1 hooks pass their shipped CLI (`ensureDaemon(root, { cli })`), one version source via esbuild `define`, `front-desk` bundled, a note before any throwing start step; B2 Vitest resolved from the project root and imported lazily, only type imports at top level, same for @parcel/watcher (N11); S1 Stop blocks only on current failures and names pending ones; S2 liveness in `StatusHeader` and header line, delivered once per consumer on change, PostToolBatch and Stop call `ensureDaemon` on a stale heartbeat, skill caveat; S4 marketplace `path` and a first install step that works, README; S5 the ship-shaped test (git archive copy, no node_modules above, fixture with its own Vitest, no `SQUEAL_CLI`, bundles driven by recorded JSON, real spawned daemon, PostToolBatch delta); S6 SubagentStop unregisters; S8 `probeDaemon` tries the recorded socket first; N1, N2, N3, N4, N6, N10. | The ship-shaped test passes; every probe in the review's sections A, B1 and E would now succeed. |
| 001-33 daemon policy and socket hardening | done | S3 one non-throwing `loadPolicy(root) -> { policy, problems }` in `src/core/daemon/policy.ts`, `src/harness/claude-code/policy.ts` becomes a re-export, bad policy is a state with one note and defaults for the bad keys, a revision touching `squeal.config.json` reloads and re-keys `inputs` and `env.allowlist`; S8 per-user socket directory with owner and mode checks, lock taken before `openStore({ checkIntegrity })`; N7 no log file (notes are the record, amended D12); N8 test that a Vitest worker pool still stops on SIGTERM under `ownSignals`. | Tests for each; the review's probe H bad-policy scenario yields one note and a running daemon. |

### Wave 4: proof

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-40 end to end | done | Per the "Inputs for wave 4" section of `reviews/wave-3.md` (plugin copy via git archive, no `SQUEAL_CLI`, recorded hook JSON driving the bundles, real spawned daemons, fresh content per edit). Fixture repository with two worktrees: PASS to FAIL, FAIL to PASS, silence on break-and-recover, inheritance with zero runs, isolation of edits between worktrees. | All scenarios in spec Testing pass in CI. |
| 001-41 dogfooding report | done | Per the "Inputs for wave 4" section of `reviews/wave-3.md` (plugin-dir load and one real marketplace install, latency and duplicate measurements on this repository's store, PreToolUse and Stop reactions, interactive waiter, liveness). Run Squeal on this repository with Claude Code interactive and `-p`. Record delivery latency, duplicate rate, PreToolUse reactions. Write `specifications/001-core-loop/lessons.md` and resolve open questions 1, 3 and 6. | Report committed; open questions updated in spec. |

### Wave 4.5: dogfooding fixes (parallel, from `specifications/001-core-loop/lessons.md` Defects and `test/e2e` expected failures)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-42 scheduler: revision lag and ordering | done | Defect 1: `handleBatch` never awaits the runner while holding the revision path; store work lands within the debounce window during a tier, runner refinement is queued behind the tier (D2 as amended). Defect 3: `RunnerAdapter.affected` reports direct importers separately (additive), queue orders failing, direct, transitive, never-run, shortest last duration first within a class (D5 as amended). Defect 6: notes strip ANSI at `appendNote`. | Tests: a revision lands within 500 ms while a 5 s tier runs; an edit behind a barrel runs the module's own test first; a note from a coloured runner error is plain text. |
| 001-43 state, delivery, status wording | done | Defect 2: fingerprint normalization of UUIDs, long hex, temp and cache paths (D6). Defect 4: header and registration say when test files are not yet listed. Defect 7: dirty flag labelled with its revision, not known without a daemon. Lessons surprise 7: full-suite line reworded as a checkpoint request. The two `test/e2e/worktrees.test.ts` expected failures: inherited count in `StatusHeader` and registration text; a break of an inherited pass never told reads `PASS -> FAIL` from the prior known state. Flip both `it.fails` to `it`. | Tests for each; `test/e2e/worktrees.test.ts` fully green. |
| 001-44 harness, CLI and policy inputs | done | Defect 5: SessionEnd unregisters reliably (investigate the `/exit` case; add a startup sweep that unregisters consumers of the same session id when a new SessionStart arrives). `squeal status --wait <ms>` (D7). Per-test-file `inputs` map in policy, closure assembly and the loader (D11, D3). Skill: replace `sleep` polling advice with `status --wait`; README: `gh auth login` or SSH as the prerequisite for the private marketplace (lessons surprise 9). Rebuild bundles as the last commit. | Tests for each; skill and README updated. |

### Wave 4.6: final review fixes (one worker, from `specifications/001-core-loop/reviews/wave-4.5.md`)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-45 close the review | done | S1 refined-revision marker written by the refinement commit and read by headers, status, `status --wait` and Stop as pending; S2 `status --wait` returns a distinct outcome without a daemon and the skill sentence is fixed; S3 split `applyRevision` into a runner phase without the lock and an apply phase under it with a freshness re-check (or, if unsafe, amend D2 with the measured bound); S4 sweep only on `startup` and `resume`; S5 note map keys and input globs that match nothing; S6 the six missing tests; N1 module duration from `onTestModuleEnd`; N5 keep the last heartbeat after `squeal stop`; N7 comment; N8 `AggregateError`. | Review probes B and G re-run as tests pass; no window in which status reads "0 pending" at a revision with unrun work. |

### Wave 5: shipped proof

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-46 dogfooding re-run | done | Repeat the measurements of `lessons.md` on this repository after waves 4.5 and 4.6 with the real Claude Code CLI: edit-to-delivery p50 and p95 with duration ordering, whether agents use `status --wait` instead of `sleep`, `/exit` consumer leaks, hook p95 at calm load, and the review's items 2 and 3. Append a dated section to `lessons.md`; list any new defect. | Measurements recorded; `status.md` moves to shipped if goals 1 to 7 hold, or lists what still blocks. |

### Wave 6: post-ship defects (parallel, from `lessons.md` re-run defects 8 to 10, none blocking; briefs in `specifications/001-core-loop/tasks/wave-6.md`)

| Task | Status | Scope | Done when |
|---|---|---|---|
| 001-47 interactive consumer liveness | running | Defect 8: Claude Code 2.1.288 runs no SessionEnd on an interactive exit after a typed prompt, so consumers linger 12 h and the daemon cannot idle out. Give interactive consumers a liveness signal that does not depend on SessionEnd (the waiter's poll, or a shorter expiry for consumers whose waiter is gone). Defect 10: re-arm the waiter after an interrupted turn (UserPromptSubmit or PostToolBatch when no waiter holds the lock). | Attended `/exit` after a typed prompt leaves no consumer past the shortened expiry; an interrupted turn re-arms the waiter. |
| 001-48 forked-agent SubagentStop | running | Defect 9: `stop.ts` must not apply `blockOnKnownFailures` to Claude Code's internal forks (`prompt_suggestion` and similar); detect by agent type or source and treat them as not consumers. | A fork's SubagentStop is never blocked and never registers a consumer. |

## Later

- 002 pytest runner adapter.
- 003 inherited-pass re-verification policy, if dogfooding shows stale escapes.
- 004 Pi and OpenCode adapters.
- macOS verification before any public release.
