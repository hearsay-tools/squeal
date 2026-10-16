# Proposal: split spec 001 into Core, Claude Code and Vitest subsystem specs

Written 2026-10-16 by coordinator session 834c16e6, from the repository at main `88d75112`. This is a proposal for the human. Its approval authorizes no product change, no dispatch and no resumption of implementation. Nothing in this document edits the board, a spec, a skill or a running worker.

Three labels are used throughout. **Fact**: what the repository shows today, with a file or row to check. **Recommendation**: what this proposal suggests. **Decision**: a choice only the human makes, collected in section 8.

## 1. Facts: what 001 is today

- `spec.md` is 263 lines and about 172 KB: 7 goals, 8 non-goals, 12 design sections D1 to D12, a Testing section, 9 open questions. Single paragraphs run to 12 KB (D10's first paragraph). `status.md` is 268 lines, about 200 of them dated amendments. Beside them: 106 review files, 86 `tasks/001-*/notes.md` folders, 27 research files, 2 quality scans, an 856-line `lessons.md`.
- `docs/board.md` is 1,197 lines. The 001 section holds 410 rows (waves 0 to 17). At `88d75112`, 22 are open: 20 `planned`, 1 `review` (001-422), 1 `running` (001-434). One is `dropped` (001-284) and one `superseded` (001-408).
- Stage: `shipped` since 2026-10-06. Every row since then is a defect, a review repair, a research row or a human-requested change. Waves 13 to 17 sit under one board heading.
- Five later specs already amend 001 by reference and were never folded into its text: 002 D5 moved the harness-neutral hook code to `src/harness/shared/`, 002 D8 renamed "the Claude Code plugin" to "the harness plugin" in D11; 003 D7 and D8 put the composite runner in core and removed D11's "a project without Vitest is a runner failure"; 004 owns scheduler changes for the slow tier "by agreement with the 001 coordinator" and amends Stop in its D9; 005 D3 took `squeal` on the PATH, install and setup, and 005 owns primer and skill wording while 001 owns their mechanism and facts (human, 2026-10-12); 010 owns CI.
- Code (63,971 lines under `src/`): `src/core/*` (capacity, daemon, daemon-loop, delivery, fs, hash, keys, retry, revision, scheduler, slow, state, status, store, types, waiter-lock, watcher), `src/runners/vitest/*` and `src/runners/observe/*` (the runtime-input recorder, shared with node:test), `src/harness/claude-code/*` and `src/harness/shared/*` (imported by codex, pi and opencode too), `src/cli/*`, `plugins/claude-code/*` (`hooks/hooks.json`, committed `dist/`, `skills/squeal`, `skills/setup`, `bin/`). Tests: `test/harness` 101 files, `test/runners` 109, `test/scheduler` 96, `test/daemon` 64, `test/cli` 56, `test/e2e` 16.
- Import direction: core imports no runner or harness statically, except `src/core/daemon/daemon.ts` (dynamic import of `runners/vitest`), `node-test-runners.ts` and `pytest-runners.ts`. `src/runners/vitest` imports nothing from `src/harness`; `src/harness/claude-code` imports nothing from `src/runners`. The two leaf subsystems do not touch each other.
- In flight, owned by coordinator session 942c4112 (its handoff's resume notes): candidate `cand/0.1.203` at `7483a2e1` carries 001-422 (four worker commits), the coordinator's B1 repair of review 001-432, and the build with key format 11. Re-review 001-434 (codex worker 4e9bca50) is running against it. On PASS that session lands 0.1.203 on main and marks 001-422 and 001-434 done; a second failing review ends the loop and goes to the human.
- Ten issue-triage coordinator sessions committed board rows on their own branches, none pushed. Six of them number their new row **001-434** (issues #7, #8, #10, #13, #14, #15), one numbers it **001-433** (issue #9) and one **004-64** (issue #12). All three numbers are taken on main (001-434 the re-review, 001-433 `scratch.test.ts`'s socket budget, 004-64 a done 004 re-review). Issue #6's branch uses 005-67, which is free. Two branches (5f9e0c63, 7688c6fd) hold only a research brief for issue #17. Every triage row says "surface to the human; do not dispatch".
- Open GitHub issues at hearsay-tools/squeal: 1, 3, 4, 6 to 17. Issue #1 criterion 1 is 001-422; criteria 2 and 3 stay open.
- Holds in force, as evidenced: new waves and measurements wait while the host is loaded by this project's own sessions (human, 2026-10-09 and 2026-10-15; `docs/process.md`, "Test runs on a shared host"); eval runs take turns and 001-380 asks before an eval run; 001-381 is research the human asked for on 2026-10-14; each triage row carries its own "human decision first" hold. This proposal infers no exception to any of them.

## 2. The three subsystems

### 2.1 Core

**Responsibility.** Harness-neutral and runner-neutral: worktrees, repository and store (D1, D8), watcher and revisions (D2), content keys and closures (D3's generic parts), scheduling and validity (D5), known states, transitions, consumer views and message shapes (D6), status, why, failures and the wait (D7), daemon lifecycle (D10), policy loader and the policy catalogue (D11), error handling and process reaping (D12), capacity, and both adapter contracts (`RunnerAdapter`, `HarnessDelivery`, the hook contract of section 2.4).

**Owns.** `src/core/**`, `src/cli/**` except the harness subcommands, `src/harness/shared/**` as the hook contract (decided Q2), `src/runners/observe/**` (the shared recorder; decided Q3), `test/{capacity,cli,daemon,delivery,fs,hash,integration,keys,policy,retry,revision,scheduler,slow,state,status,store,watcher}`, the store schema, `squeal.config.json` keys not owned by another spec.

**Excludes.** Any hook event name, plugin manifest or packaging; anything that reads Vite's module graph or `createVitest`; wording that 005 owns; the slow tier's rules (004); node:test (003) and pytest (007) adapters; evals (006); CI (010).

### 2.2 Claude Code integration

**Responsibility.** Claude Code's events mapped onto the hook contract: `hooks/hooks.json`, the eight entries, their 2 s budget and the 80 ms and 10 ms p95 targets, the `asyncRewake` idle waiter and its `-p` guard, forked-agent detection, `CLAUDE_CODE_SESSION_ATTENDED`, `CLAUDE_PROJECT_DIR`, the per-session root under `<runtime dir>/squeal-sessions/`, SubagentStart's isolated `cwd`, the plugin's skills and `bin/`, marketplace install through `squeal init`, the committed `dist/` and its drift check, interactive consumer liveness through the waiter lock.

**Owns.** `src/harness/claude-code/**`, `plugins/claude-code/**`, `src/cli/init.ts`'s Claude Code path, `test/harness/*` files that drive Claude Code hook JSON, `test/plugins`, the e2e suites driven through recorded Claude Code hooks (`test/e2e/shipped-plugin.test.ts`, `transitions.test.ts`, `worktrees.test.ts`, `plugin-copy.test.ts`, `policy.test.ts`; see Decision Q5).

**Excludes.** The content of a delta, header or primer fact (Core); the wording (005); `src/harness/shared/**` (Core's hook contract, decided Q2); Codex, Pi and OpenCode (002, 009, 008); the test-command deny's rule (005 D8).

### 2.3 Vitest integration

**Responsibility.** One warm `vitest/node` instance per worktree and lane: invalidate, affected, closure, enumerate, run, environment, test-file listing; the Vitest-specific key inputs (resolved config, `configFileDependencies`, setup and `globalSetup` closures, environment and reporter packages, installed-package segments through Vite's resolution); the stamps of bytes Vite read, touch handling, the optimizer switch, the gate between runs and the runner part, result extraction from reporter hooks, file-level and `describe`-level errors, the failed-start detection, `vitest.excludeProjects`, the `maxWorkers` ceiling and resize, the `SQUEAL_DAEMON_CHILD` and recorder delivery through `createVitest`'s `env`, `vitest.log`.

**Owns.** `src/runners/vitest/**`, `test/runners/vitest/**`, `test/fixtures/*` that are Vitest projects, the D11 keys `vitest.*`.

**Excludes.** What a key is made of and how it is compared (Core D3); when a tier runs and what happens to its results (Core D5); the recorder's own code and its `--import`/`--require` rule (Core, decided Q3); the install-detection rule (Core, Decision Q4); node:test's and pytest's use of the same contracts.

### 2.4 Shared contracts

| Contract | Defined in | Provider | Consumers | Spec text today |
|---|---|---|---|---|
| `RunnerAdapter`: `name`, `adapterVersion`, `invalidate`, `recheck?`, `affected`, `closure`, `enumerate`, `testFiles`, `omittedTestFiles?`, `environment`, `slowWidth?`, `run(files, RunOptions) -> RunReport`, `lane?`, `releaseLane?`, `close` | `src/core/types/runner.ts` | Vitest, node:test, pytest | D4 names five of these; 003 D7 adds the composite and `lane` |
| Runner-side shapes: `InvalidatedPath` kinds (edit, add, delete, touch), `RunnerEnvironment`, `RunnerClosure` and `RunnerPackages`, `CheckRunResult`, `FileLevelError`, `RunReport` (`completed`, `observed`, `reads`, `end`, startup failure), `RunOptions` (`stop`, `observeIgnored`, width) | same file | Core scheduler | D4, D5, D12 by example |
| Check identity `(project, relative test path, fullName)`, duplicate-name suffix, error capping (200 chars, 3 causes) | D4 last paragraph, `src/core/state/check-name.ts` | every runner | D4, D6 |
| Adapter version re-keys one runner; `KEY_FORMAT_VERSION` re-keys all; the guard in `test/keys/key-sources.ts` exempts `src/cli`, `src/core/status`, `src/core/delivery`, `src/harness` (presentation) and guards the rest (meaning) | D3, D4 | all | D3, D4 |
| Runner selection: which adapters the daemon builds (`vitestDetected`, `nodeTest` projects, pytest) | `src/core/daemon/runner.ts`, `daemon.ts` | Core | primer facts, status | 003 D7; 001 D9 primer paragraph |
| Shared recorder: `src/runners/observe/*`, `SQUEAL_OBSERVE`, the `--import`/`--require` choice, `RunReport.observed` and `reads` | D4 "Observed runtime inputs", D11 Fidelity | Core (decided Q3) | Vitest workers, node:test, pytest warm-up | D4, D11 |
| `HarnessDelivery`: `register`, `unregister`, `onToolBoundary`, `peek`, `waitForDelta`, `startTurn`, `endTurn`, `status` | `src/core/types/delivery.ts` | Core | every harness | D9 names three operations |
| Hook contract (the behaviour of `src/harness/shared/*`): registration and primer facts, delta at a boundary, deny-once on a seen regression, Stop speaks only with news and records pending files, turn state, liveness told once, "starting" rule, uncovered-edit line, consumer version and step-down ask, harness process record, leaving mark, per-session root | D9 prose, D6, D10 | Core (decided Q2) | Claude Code, Codex, Pi, OpenCode | D9 as if Claude-only; 002 D5 |
| Store rows hooks write without a daemon: `meta` turn state, told liveness, `leaving:<worktree>`, `uncovered-told:<worktree>`, `slow-tier-told:`, consumer version, harness process | D6, D9, D10 | Core schema | hooks | scattered |
| Socket protocol: ping, `step-down`, `stop`, `sync`, nudge, 100 ms hook timeout | D1, D7, D10 | Core daemon | hooks, CLI | D9, D10 |
| Policy keys read by hooks: `interrupt.onRegression`, `stop.*`, `delivery.uncoveredEdits`, `testCommand.denyWhenCurrent` | D11, 005 D8 | Core loader | hooks | D11 |
| Message formats: full header and news header, 10,000-character cap, 1,000-character uncovered line, primer within 1,500 characters | D6, D9 | Core formatters | every harness, 006's parsers | D6, D9 |

## 3. Facts: coupling that blurs the boundaries

Recorded here, not to be fixed by this proposal. Each is a seam a migration must name, not an architectural change.

1. Core knows every runner by name. `src/core/daemon/daemon.ts` builds the Vitest adapter and the slow Vitest instance; `src/core/daemon/runner.ts` holds the Vitest config-name regex and `vitestDetected`; `src/core/daemon/policy.ts` and `src/core/types/policy.ts` hold `vitest.excludeProjects`; `src/core/status/snapshot.ts` and `format-status.ts` render the excluded projects; `src/core/status/run-log.ts` knows `vitest.log` and a `not-vitest` state; `src/core/state/optimizer-note.ts` is Vitest text.
2. Core parses the Vitest adapter's English. `src/core/delivery/own-edit.ts` matches the reason written by `src/runners/vitest/moved.ts` (quality scan 2026-10-2, slice 1).
3. Core names harnesses. `src/core/slow/stop-wait.ts` declares `StopWaitHarness = "claude-code" | "codex" | "pi"`; `src/core/waiter-lock` and D10's 10-minute expiry exist for Claude Code's idle waiter; D11's inherited-environment strip list names `CEZ_*`, `CODEX_SESSION_ID`, `CODEX_THREAD_ID`, `PI_SESSION_ID`, `CLAUDECODE`. D9's sentence "Nothing in the core depends on Claude Code" is not literally true.
4. The Vitest adapter reaches past `RunnerAdapter` into core internals: `core/daemon/policy`, `core/state/fingerprint`, `core/state/optimizer-note`, `core/keys`, `core/hash`, `core/run-log`.
5. Node-ecosystem logic sits in core and serves two runners: install detection and the npm hidden-lockfile trust rule (`src/core/scheduler/install.ts`, `install-stamp.ts`), the installed-dependency segment scheme (`src/core/keys/environment.ts`, `observed.ts`), while the Vite-side package resolution is `src/runners/vitest/packages.ts`. pytest has none of it.
6. The recorder lives under `src/runners/observe/` but is delivered by Vitest, node:test and pytest's warm-up, and its form rule (D11 Fidelity) is runner-neutral.
7. `src/cli` mixes owners: `init.ts` defaults to the Claude Code marketplace and takes `--harness codex`; `status-command.ts` imports `harness/codex/command`; `node-test-seed.ts` and `pytest-seed.ts` belong to 003 and 007; `setup/*`, `update.ts`, `warmup.ts` belong to 005.
8. Scheduler rules carry Vitest evidence in their text: D5's measurements, the gate paragraph (`src/runners/vitest/gate.ts`), the global-setup failed-start detection ("Vitest marks a project's `globalSetup` done before it runs it").
9. The e2e proofs of Core goals are driven through Claude Code hook JSON (`test/e2e/shipped-plugin.test.ts`, `transitions.test.ts`, `worktrees.test.ts`), so a Core change is proven through the Claude Code subsystem.
10. Primer and skill texts have three owners: 001 the facts, 005 the wording, each harness its copy under `plugins/*/skills/squeal`.
11. Policy catalogue: D11 lists 001's keys only. `nodeTest`, `slow`, `pytest`, `testCommand` live in 003, 004, 007 and 005. No single document lists every key with its owner.

## 4. Mapping of 001 sections to their homes

Legend for the home column: **C** Core, **CC** Claude Code, **V** Vitest, **H** hook contract (shared code; Core since Decision Q2), **S** superseded or stale text (kept in 001 as history, never deleted). A split section names its parts.

| 001 section | Home | Split and notes | Duplicates, contradictions, uncertain ownership |
|---|---|---|---|
| Problem | C | The interaction model. | "One test ecosystem (Vitest), one harness (Claude Code)" is S since 002, 003, 007, 008, 009. |
| Goal 1, 2 (`PASS -> FAIL`, `FAIL -> PASS` within one tool call, silence otherwise) | C + CC | What arrives: C (D6). "Within one tool call, inside the same turn": CC, and each harness spec restates its own bound. | None. |
| Goal 3 (truth at delivery, revision label, pending flag) | C | | None. |
| Goal 4 (inheritance by byte-identical inputs) | C | | None. |
| Goal 5 (`squeal status` answers) | C | | None. |
| Goal 6 (hook never blocks past its timeout; dead daemon degrades) | CC + C | The 2 s budget and exit-0-silent: CC and H. Store-readable status without a daemon: C. | None. |
| Goal 7 (one shared store, many worktrees and agents) | C | | None. |
| Non-goal: per-test closures | C | Still true. | None. |
| Non-goal: runtime reads, env, network as inputs | S | Partly reversed by D4 "Observed runtime inputs" (001-132) and D11 `observe.runtimeInputs`. | Contradiction inside 001: the non-goal stands while D4 records runtime reads. Record as amended, not deleted. |
| Non-goal: other check types; other harnesses | S | 003, 007; 002, 008, 009. | Stale. |
| Non-goal: background re-verification | C | Open question 1. | None. |
| Non-goal: dashboards, remote stores | C | | None. |
| Non-goal: idle wake in `-p` | CC | | None. |
| Non-goal: macOS verification | C + V + CC | Cross-cutting proof item; C owns the row. | Uncertain ownership of the proof. |
| D1 worktree, repository, store, socket | C | Store layout, common dir, socket path rule, per-user directory. | Duplicate: "hook scripts resolve the common directory without spawning git" repeats in D9's `sh` paragraph. The rule is H; its Claude Code `sh` text is CC. |
| D2 watcher and revisions | C | All of it, the 5 s temp-file rule included (Claude-observed, harness-neutral). | One sentence is V: "Vitest's adapter answers its runner part during its run, and waits only to recreate its instance". The touch kind handed to `invalidate` is a Core-to-runner contract. |
| D3 results keyed by content; file hash; key format version and guard; check key; closure; incremental maintenance | C | | None. |
| D3 environment hash | C + V | The composition contract (key format version, adapter version, Node, platform, allow-listed env, installed dependencies, runner-reported files): C. The Vitest inputs (resolved config, `configFileDependencies`, setup and `globalSetup` closures, environment and reporter packages, `snapshotSerializers`, `runner`, `diff`): V. | Wording "per Vitest project" is stale since 003 D3 and 007. |
| D3 installed dependencies (hidden lockfile trust, package folders, scheme B segments, fallback cases 1 to 5, opaque packages, measurements) | C with V parts | The trust rule, the segment scheme, the fallback cases and the opaque scan: C (Node-ecosystem, shared with node:test). Which packages a test file reaches through Vite's resolution, bare specifiers, `require` scan, docblock environment: V. | Uncertain: Node-specific logic in a runner-neutral spec (Decision Q4). |
| D3 `package.json` re-resolution rules (001-72, 001-79, 001-81) | C trigger, V meaning | "Adding or deleting a file re-resolves closures of importers from that directory": C. What a manifest edit stales in Vite's graph: V (also in D4). | Stated in both D3 and D4. |
| D4 Vitest runner adapter: instance, invalidate rules 1 to 4, manifest staleness, `affected`, `closure`, `enumerate`, `run`, reporter hooks, `fsModuleCache`, stamps of bytes Vite read, touched files, the optimizer off, measurements | V | | D4 names five adapter operations; the interface has fifteen members. The spec understates the contract. |
| D4 observed runtime inputs (recorder) | C (decided Q3) + V | The recorder, its reach, attribution, batching, what it leaves out, `observeIgnored`: C. Delivery through `createVitest`'s `env`: V. node:test's adoption is 003's. | Decided Q3: Core. "Spec 003 decision 3 is reversed" is a cross-spec amendment by prose. |
| D4 check identity, duplicate suffix, error capping, per-run floor | C contract, V values | | None. |
| D5 scheduler: validity, steps 1 to 5, ordering, tiers, backlog, cancel, timeout split, sharing, lanes, bounds, install wait, stability check, observed growth, checkpoints | C | | V paragraphs inside D5: "What the Vitest adapter's calls exclude (`gate.ts`)"; the runner-failure examples (ENOENT under the instance temp dir, Vite module runner error, instance recreated on a lockfile change, "a new Vitest version needs a daemon restart"); the failed-start detection. The install wait is C with the Node caveat of Q4. Measurements over Vitest runs are history, kept. |
| D6 known state, setup check, transitions, inherited fail confirmation, re-run once, retry, consumer view, header forms, caps, factual wording | C | | The setup check is a C state kind with a V producer. "Closure method: static imports plus declared inputs" is admitted stale by D3 itself. The uncovered-edit trust rule here pairs with the line in D9. |
| D7 status, `--json`, `--wait` and the re-key moves ledger, incarnation, daemon-died line, notes and topics, `remove`, `failures`, `why` durations | C | | `vitest.log` name is V. status.md line 152 (001-196) says "spec text to be folded by the coordinator": an acknowledged unfolded amendment. Verify quality scan 2026-10-2 slice 10 (seven landed decisions without spec text). |
| D8 shared store, tables, pruning, claims, schema version | C | | None. |
| D9 plugin contents, each hook's behaviour, forks, `-p`, idle waiter, harness process walk, skill, `bin/squeal`, `sh` fast path, per-session root, SubagentStop leaving mark | CC + H | Event names, timeouts, `asyncRewake`, forks, `CLAUDE_*` variables, plugin files, marketplace: CC. The behaviour that `src/harness/shared/*` implements for every harness (see 2.4): H. | D9 reads as Claude-only although 002 D5 moved the logic to shared code. "Nothing in the core depends on Claude Code" contradicts section 3 item 3. The three-operation interface sentence understates `HarnessDelivery`. |
| D10 daemon lifecycle: spawn, lock and waiters, socket, temp dir, working directory, exit conditions, drain, unused exit and rest, step-down handshake, `squeal stop`, consumer expiry | C | | CC parts: "an interactive main agent's liveness is its idle waiter", the waiter-lock 10-minute expiry, "Claude Code runs no SessionEnd on an interactive exit". The hook side of the step-down ask is H. |
| D11 policy loader and keys, Capacity (slots, pool, PSI, priority, user config), Fidelity, Inherited environment | C | `vitest.excludeProjects`, the `maxWorkers` ceiling and warm resize, "Squeal loads Vitest from the project", `update: 'none'`: V. Fidelity's recorder-form rule: C (with Q3); its delivery in Vitest workers: V. | Stale by reference: "a project without Vitest is a runner failure" (003 D8 removed it); "the Claude Code plugin" (002 D8). D11 is not the policy catalogue (section 3 item 11). The harness variable list couples C to each harness. |
| D12 error handling: untrusted run, config change, process reaping, watcher error, store corrupt, dead daemon, hook error exit 0, notes as the record, newer schema | C | Hook internal error exit 0: H. Vitest crash classes and the `SQUEAL_DAEMON_CHILD` delivery through `createVitest`: V. | "Spec 004's row 004-18 replaces this with a mark per lane" is written as future; 004-18 is done. D12's timeout bullet restates D5's split by reference (acceptable). |
| Testing: core pure functions; store | C | | None. |
| Testing: runner adapter on fixture projects | V | | None. |
| Testing: hook scripts, recorded JSON, p95 budget | CC | | None. |
| Testing: end to end, two worktrees | CC files, C goals | | Uncertain ownership (Decision Q5). |
| Testing: manual dogfood | CC + C | | None. |
| Open question 1 (inherited passes current or stale) | C | Still open; dogfooding evidence attached. | None. |
| Open questions 2, 5, 9 | C | Decided or measured. | None. |
| Open question 3 (PreToolUse denial wording, default on) | CC + 005 | Mechanism CC, wording 005. | None. |
| Open question 4 (`related.ts` wrapper risk) | V | Decided. | None. |
| Open question 6 (long tool calls delay delivery, monitor) | CC | Proposed answer recorded; 005 D2 later added the named-file wait. | None. |
| Open question 7 (macOS) | C with a V item | Watcher fds, socket limit, lock release: C. The prebuilt `@parcel/watcher` binary: C. Nothing V-specific. | Needs a macOS run before any public release (still open). |
| Open question 8 (Vite cache shared with the project) | V | Decided. | None. |
| References, ADRs 0001 to 0004 | C | ADRs span specs and stay in `docs/decisions/`. | None. |
| status.md "Decisions so far" (6 lines) | C | "Delivery must reach the agent mid-turn" also binds each harness. | None. |
| status.md amendments (about 200 dated lines) | 001 (history) | Stay in place. Each new spec's `status.md` opens with the pointer and the date of the fork. | Some entries record other specs' amendments to 001 (004-29, 007-30, 007-39): the crosswalk notes them. |
| Research files (27) | by topic | C: result-fingerprinting-prior-art, watcher-daemon-and-shared-store, pull-advances-push, per-package-keys, harness-process-liveness, process-group-tests-under-squeal, observed-runtime-inputs, shared-runs, wait-from-store, nested-worktree-watch, injected-environment, host-capacity, environment-failures, daemon-sigkill, daemon-under-harnesses, fresh-worktree-reuse, slow-claims (with 004). V: vitest-internals, cezar-e2e-setup, revert-restore-pass, revert-restore-pass-2. CC: claude-code-integration, uncovered-suites, uncovered-trust, primer-skill-writing (with 005). Process: release-hub. | Files stay where they are; the new specs link them. |
| Reviews (106), task notes (86), `lessons.md`, quality scans | 001 (history) | Stay in place. Rows keep their numbers, so every `reviews/wave-N.md` and `tasks/001-NNN` reference keeps resolving. | None. |

### 4.1 Text that is superseded but must not disappear

| Text in 001 | Superseded by | Disposition |
|---|---|---|
| Problem: one ecosystem, one harness | 002, 003, 007, 008, 009 | Keep, mark "as of 2026-10-06" in the crosswalk. |
| Non-goals: other check types, other harnesses, runtime reads | 003, 007; 002, 008, 009; 001-132 | Keep, listed as amended non-goals in the Core spec. |
| D11: a project without Vitest is a runner failure | 003 D7, D8 | Core spec carries 003's rule; 001 text kept. |
| D11: "the Claude Code plugin" | 002 D8 | Core spec says "the harness plugin". |
| D3: environment hash "per Vitest project" | 003 D3, 007 | Core spec says "per runner project". |
| D12: 004-18 "replaces" | 004-18 done | Core spec states the per-lane mark as current. |
| D9: three-operation adapter interface; D4: five-operation runner interface | `src/core/types/{delivery,runner}.ts` | Core spec documents the full contracts; 001 text kept. |

Guard against silent loss (Recommendation): before any new spec is accepted, a throwaway script splits 001's Design into paragraphs and confirms each appears verbatim in exactly one new spec or in table 4.1. The script's output is attached to the migration row's notes.

## 5. Disposition of 001 board rows

Row numbers never change. A row that moves keeps `001-NNN` and gains a home. New work after the split takes the new prefix (section 6). "Boundary" is what the row may touch; "endpoint" is its stopping condition.

### 5.1 Open rows at main `88d75112`

| Row | State | Proposed home | Depends on | Acceptance boundary | Endpoint | Migrate now? |
|---|---|---|---|---|---|---|
| 001-422 busy store costs an edit its pass and blocks heartbeats | review (cand/0.1.203) | C | 001-434 PASS | `change-feed.ts`, `daemon-loop`, `lifecycle.ts`, `scheduler.ts #stall`, `connection.ts`; issue #1 criterion 1 only | 0.1.203 on main, D8/D12 amendment, issue #1 comment | No: in flight under session 942c4112. |
| 001-434 re-review of cand/0.1.203 | running | C (process row) | none | round 2 of `reviews/wave-17.md` | verdict committed | No: running. |
| 001-338 status-wait timing helper | planned | C (tests) | none | three test files, `wait-clock.ts`; test-only | every site builds arguments before the clock | Yes. |
| 001-341 tmpfs e2e fixture on `noexec` | planned | C (e2e infrastructure; Q5) | none | `test/e2e/harness.ts`; test-only | `noexec` host runs or falls back, shown by a probe | Yes. |
| 001-342 Stop wait held to 1.5 s wall | planned | C (hook contract) | none | `test/harness/stop-slow-wait.test.ts`; product only if at fault | cause named; bound on meaning not wall time | Yes. |
| 001-346 optimizer note fails under a long writer | planned | C | 001-422 landed (same seam) | `daemon.ts #optimizerOff`, `busy-store.test.ts` | note written after the lock frees or the test's premise fixed | After 001-422. |
| 001-358 starting-daemon heartbeat test under load | planned | C (hook contract) | none | `test/harness/starting-daemon.test.ts` | cause named; 20 runs green beside load | Yes. |
| 001-359 timeout-reason comments | planned | C | none | two comments | lint, typecheck, build green | Yes; a coordinator inline edit. |
| 001-364 backlog tier cancelled by an edit no file reads | planned | C | none | D5 cancel rule, scheduler | tests: outside-closure edit cancels nothing; finished results kept | Yes. |
| 001-365 `bareNote` names node:test files with declared inputs | planned | **003**, not any of the three | none | `src/runners/node-test/adapter-project.ts` | two tests | Misfiled under 001; move to 003's section. |
| 001-366 backlog budget sums file times serially | planned | C | research first | `backlog.ts`; D5 budget | tests plus the latency bound restated | Yes, research shape first. |
| 001-373 counts name setup failures apart | planned | C, crosses 005 | brief to 005 first (board) | status counts, 005 D1 quoters, skill references | counts and every quoter agree | Yes, with 005's ack. |
| 001-379 backlog tiers shrink under CPU pressure | planned | C | 001-380 (P2 threshold) | capacity pool | tests with an injected pressure reader | After 001-380. |
| 001-380 capacity probes P1 to P3 | planned | C (research) | calm host, eval-free turn (hold) | scratch clones only | results appended to `research/host-capacity.md` | Held by the host-load rule. |
| 001-381 research: an edit splits its own backlog tier | planned | C (research) | human asked 2026-10-14 | read-only | `research/edit-splits-backlog.md`, a D5 decision for the human | Yes, when the human says. |
| 001-383 withheld run decides before a timeout split | planned | C | none | `withheldForTouch`, `requeueSplit` | regression red then green | Yes. |
| 001-391 daemon drops inherited session variables | planned | C, crosses every harness and `CLAUDE.md` | ask the human for the `CLAUDE.md` edit | daemon env at start, loader keys `env.remove`, `env.keep` | I2 fixture; hash tests | Yes, with the ask. |
| 001-397 `squeal retry` of a failed global setup | planned | C with a V trigger | none | retry plumbing, `retryRunner`, one forced file | setup retried once per revision; second refused | Yes. |
| 001-402 node:test module recorder's spawn patch | planned | **003** | the Core recorder's pattern (Q3) | `src/runners/node-test/runtime/recorder.cjs` | two tests pass together | Misfiled under 001; move to 003's section. |
| 001-431 recorder-fidelity tests fail under Squeal's daemon | planned | C (recorder) with V and 003 tests | none | `observe-fidelity.test.ts`, `run-reads-fidelity.test.ts`, the outer recorder's reach | both pass under `squeal run --all --wait` and plain Vitest | Yes. |
| 001-425 `graph-cost.test.ts` ratio under CI load | planned | **003** | none | `test/runners/node-test/graph-cost.test.ts` | assertion without a wall-clock ratio | Misfiled under 001; move to 003's section. |
| 001-433 `scratch.test.ts` socket budget on a GitHub runner | planned | C (tests) | none | `test/daemon/scratch.test.ts` | assertion proves the ordering, not 2 s | Yes. |
| 001-284 one-shot session detection | dropped | history | | | | No change. |
| 001-408 stop-gap freeze race | superseded by 001-355 | history | | | | No change. |

### 5.2 Unnumbered 001 items in the board's "Later" section

| Item | Proposed home | Note |
|---|---|---|
| SubagentStop report restarts the subagent (005 research, 2.1.295) | CC | Probe first. |
| `store.prune` leaves per-worktree `meta` rows | C | A registry of per-worktree prefixes exists since 001-254 (`WORKTREE_META_ROWS`); verify what is still missing. |
| e2e leaves `/tmp/squeal-e2e-*` behind | C (e2e infrastructure; Q5) | |
| Load-sensitive tests list (`reconcile-pass`, `lifecycle`, `stop`, `observed-growth`, `unused-stop` on Node 24) | C, H for `stop.test.ts` | |
| `squeal init` with a harness choice and 002/003 keys | CC + 005 | Already noted as a 005 candidate. |
| Inherited-pass re-verification | C | Open question 1. |
| 010 pull credit (design H in `research/pull-advances-push.md`) | C | Parked 2026-10-07. |
| macOS verification before any public release | C (row), V and CC checks | |
| 009 observation 1: a Vitest typecheck project is not run but the primer says Vitest is covered | V facts, H primer, 005 wording | |
| 009 observation 4: a load failure stays current after an ignored build appears | C | Nearest entry is 007's runtime reads. |

The three "Proposed rows" at the end of `lessons.md` (defects 30, 31, 32) are done (001-185, 001-184, 001-186).

### 5.3 Unpushed triage rows and open issues

| Issue | Branch (commit) | Number used | Proposed home | Note |
|---|---|---|---|---|
| #6 exact test-file waits select unrelated consumers | 0aea87cd (fa59e882) | 005-67 (free) | C wait (D7) with 005 D2 | |
| #7 `why` loses evidence under store contention | 0c084282 (3928d269) | 001-434 (taken) | C status and store | |
| #8 result queries fail after one second of contention | 32229739 (49ff0922) | 001-434 (taken) | C CLI and store | |
| #9 stale git identity after a commit | bff55c84 (8f719733) | 001-433 (taken) | C D2 display | |
| #10 edited unit test stays unknown after a mid-run build rewrite | 74409005 (91548904) | 001-434 (taken) | C touch rule (D2, D5) with V stamps | Uncertain split; the research names both. |
| #12 slow validation loses its daemon with requested files pending | 0e020641 (c73299a8) | 004-64 (taken) | 004 with C D10 drain | |
| #13 invalidation reasons before artifact path lists | b52afc16 (c74f283a) | 001-434 (taken) | C D7 text | |
| #14 awaited files before queued background work | 7a9c5a44 (16765a34) | 001-434 (taken) | C D5 and D7 | |
| #15 `why` omits the current worktree's own failure | 3027baf1 (d915cbdc) | 001-434 (taken) | C D6 and D8 | |
| #17 targeted verification responsive while discovery pending | 5f9e0c63, 7688c6fd (d189f659) | none yet | C D5 | Two branches hold the same brief. |
| #1 criteria 2 and 3 | none | 001-422 covers criterion 1 | C D10 and D8 | |
| #3, #4, #16 slow tier and prerequisites | none | | 004 | |
| #11 `--help` on subcommands | none | | C CLI | |

Recommendation: these rows land as `gh-<N>` rows under the board's `## Triage` section (the convention adopted on 2026-10-16, `docs/process.md`, Issue triage), with no spec number until a coordinator approves and moves each into its home. Their research files keep their paths.

## 6. Minimal migration sequence

Every step is a docs-only commit, reviewed as docs land today, none of it a product change. Order matters only where stated.

1. **Settle what is in flight.** Session 942c4112 finishes 001-434 and either lands 0.1.203 or reports a second FAIL. No other 001 row is dispatched meanwhile. Unsafe to migrate before this: 001-422, 001-434, and any row sharing their seams (001-346).
2. **Freeze 001 as the historical record.** Add a banner to `spec.md` and `status.md`: "Frozen 2026-10-DD at `<sha>`. New work lives in 011, 012, 013. The text below is kept as history; amendments after this date go to the subsystem spec named in the crosswalk." No text is deleted. Stage stays `shipped`.
3. **Create the three spec folders** (numbers are the next free ones): `011-core/`, `012-claude-code-adapter/`, `013-vitest-runner/`, each with `spec.md`, `status.md`, `tasks/`, `reviews/`, `research/README.md` (links only). Each `spec.md` is a **reference document**: 001's paragraphs lifted verbatim under new section numbers, each paragraph tagged with its source (`001 D5 ¶7`, the amending row and date) and a crosswalk table at the end (`001 D5 -> 011 C4`). The superseded sentences of table 4.1 are replaced by the current rule and the 001 wording cited. One docs commit per subsystem; the script of section 4 runs before each lands.
4. **Split the board.** Three new feature sections: `## Feature 011: core`, `## Feature 012: Claude Code adapter`, `## Feature 013: Vitest runner`. Each opens with its spec pointer and a table of the open rows moved from 001 with their original numbers (section 5.1). The 001 section shrinks to a two-line pointer; its 410 rows move verbatim to `docs/specifications/001-core-loop/board-archive.md`, so completed work stays searchable without occupying the active board. The "Later" items of 5.2 move under their homes. The misfiled rows move to 003's section.
5. **Land the triage rows** as `proposed` rows under their homes with fresh numbers, each naming its issue, its research file and its "human decision first" state. The triage branches are then deleted after a check that nothing else sits on them.
6. **Update the index** (`docs/specifications/README.md`) and `docs/process.md`'s file table only where the new folders need naming. ADRs are untouched.
7. **Record the seams.** Section 3's list goes into each subsystem spec's Exclusions as "known seams", each a candidate row the human may or may not open. No code moves in this migration.

**Reference documentation against change tickets.** After the split, each `spec.md` is the normative description of current behaviour and changes only through an accepted amendment (a dated line in its `status.md` plus the section edit). Board rows are bounded change tickets: each cites the spec sections it changes, its boundary and its stopping condition, and ends with the amendment. Research, reviews and task notes are evidence attached to rows and never normative. 001's folder is the archive: reviews, task notes, research and lessons stay there, reachable by the row numbers they carry.

**Numbering.** Existing `001-NNN` ids are permanent. New rows take `011-NN`, `012-NN`, `013-NN`. A number is allocated only from the board on main, by the coordinator who lands the row. A triage session writes its row as `gh-<issue>` under `## Triage` and a research session as `proposed-<topic>`, neither with a number, until a coordinator lands it with one (section 7, rule 6; adopted for triage on 2026-10-16, `docs/process.md`, Issue triage), which ends the collisions of section 1.

## 7. Proposed operating rules

1. **A row is not an authorization.** States: `proposed` (anyone may write it), `approved` (the human, or a standing rule the human wrote, named in the row), `running`, `review`, `done`, `dropped`. Only an `approved` row is dispatched. The board's Standing models section is such a standing rule for model choice, not for scope.
2. **Workers wait for answers.** A product, ownership or scope question from a worker is a `worker send --kind request`; the worker does not proceed on an assumption. The coordinator answers only what the spec already decides; everything else goes to the human, and the worker stays parked until the reply. Research rows are the exception: a researcher may choose its probes within its brief.
3. **Expansion needs the human.** A proposal to widen an approved outcome (a new file owner, a new spec section, a new runner or harness surface, a behaviour the done-when did not name) becomes a new `proposed` row with the finding attached. The running row finishes within its original boundary or stops and says what it left.
4. **Every assignment states its stopping condition.** A brief has an endpoint sentence beside its done-when: the test that passes, the file that is written, or the question that is answered, and the state the row takes when the endpoint is reached (`review`, or `done` for docs). A row without one is not dispatched.
5. **Review before landing.** Unchanged from `docs/process.md` steps 5 and 6: every product landing is reviewed on its candidate SHA; docs land directly; a second failing review ends the loop and goes to the human.
6. **Numbers come from main.** A row number is allocated only by the coordinator landing it, from the board on main. Triage sessions write `gh-<issue>` under `## Triage` and research sessions `proposed-<topic>`, both without a number (in force for triage since 2026-10-16, `docs/process.md`, Issue triage).
7. **Holds are stated, not inferred.** A hold the human sets is written on the board (section, date, scope) and lifted the same way. No coordinator infers an exception; a question about a hold's scope is a question to the human.
8. **One owner per section.** Each spec section names one owning subsystem. A row that must edit another subsystem's section carries that coordinator's acknowledgement in its brief, as 001-373 does today.

## 8. Decisions needed from the human

- **Q1 Shape of the split.** Decided 2026-10-16: (a). (a) Three new specs with 001's text lifted verbatim and a crosswalk, 001 frozen as history (recommended: every existing D-number reference in 106 reviews, 86 notes and specs 002 to 010 keeps resolving); (b) 001 itself becomes the Core spec by trimming, with two new specs for Claude Code and Vitest (fewer files, but the trim edits a shipped spec's text and the archive and the live spec are one file).
- **Q2 Home of the shared hook code and its rules** (`src/harness/shared/*`, the H rows in section 4, rows 001-342 and 001-358). Decided 2026-10-16: (a). (a) Core, as the harness-neutral "hook contract" section (recommended: four harnesses already depend on it and 002 D5 only moved the files); (b) the Claude Code spec, as the first implementer, with other harness specs citing it; (c) a fourth, thin spec of its own.
- **Q3 Home of the runtime-input recorder** (`src/runners/observe/*`, D4 "Observed runtime inputs", D11 Fidelity, rows 001-431, 001-402). Decided 2026-10-16: (a). (a) Core (recommended: three runners deliver it and its form rule is runner-neutral); (b) Vitest, with 003 and 007 citing it.
- **Q4 Node-ecosystem logic in Core** (install detection, hidden-lockfile trust, the installed-dependency segment scheme). (a) Core, marked "Node ecosystem; pytest has its own" (recommended for this migration, no code moves); (b) a later `node-ecosystem` section or spec when a third Node runner appears.
- **Q5 Owner of the end-to-end proofs** driven through Claude Code hook JSON (`shipped-plugin`, `transitions`, `worktrees`, the e2e harness, rows 001-341 and the `/tmp` leftovers item). (a) Claude Code owns the files, Core owns the goals they assert, each Core landing still runs them (recommended); (b) Core owns them as test infrastructure.
- **Q6 The misfiled rows** Decided 2026-10-17: move to 003.  001-365, 001-402, 001-425 (node:test code). Move them to 003's board section with their numbers kept (recommended), or keep them under Core.
- **Q7 Timing.** Decided 2026-10-16: after 001-434 settles and 0.1.203 lands or is abandoned. Start the docs-only migration after 001-434 settles and 0.1.203 lands or is abandoned (recommended), or start the spec folders now and split the board later.
- **Q8 The colliding triage rows** Decided 2026-10-17: fresh numbers at landing.  (six branches numbered 001-434, one 001-433, one 004-64). Land them as `proposed` rows with fresh numbers (recommended), or ask each triage session to renumber and push.

Approval of this proposal, with answers to Q1 to Q8, authorizes the docs-only steps of section 6 and nothing else.

## 9. Decisions recorded

2026-10-16, the human, on this proposal's section 8:

- Q1: three new specs (011, 012, 013) with 001's text lifted verbatim and a crosswalk; 001 frozen as history.
- Q2: `src/harness/shared/**` and the behaviour it implements are Core's, as a "hook contract" section of the Core spec. Rows 001-342 and 001-358 are Core rows.
- Q3: the runtime-input recorder (`src/runners/observe/**`, D4 "Observed runtime inputs", D11 Fidelity) is Core's. Row 001-431 is a Core row; 001-402 stays 003's and follows Core's pattern.
- Q7: the docs-only migration of section 6 starts only after 001-434 settles and 0.1.203 lands or is abandoned.

2026-10-17, the human:

- Q6: accepted. 001-365, 001-402 and 001-425 move to spec 003's board section with their numbers kept.
- Q8: accepted. The colliding triage rows land as `gh-<N>` rows under `## Triage` and get numbers only on approval.
- Migration: starts as soon as Q4 and Q5 are answered, as section 6 in full. Until then nothing moves.

Still open: Q4 and Q5. The human asked for the rationale; section 11 gives it with the corrected facts.

## 11. Rationale for Q4 and Q5

### Q4: where the Node-ecosystem logic lives

Facts. Three rules are Node-specific: install detection (D5: a root `package.json` that declares dependencies with nothing installed stops every runner call), the hidden-lockfile trust rule (D3: `node_modules/.package-lock.json` stands for the install only while npm would trust it), and the installed-dependency segments of a key (D3 scheme B). Their code is all under `src/core`: `src/core/scheduler/install.ts` (223 lines), `install-stamp.ts` (123), `src/core/keys/hidden-lockfile.ts`, `src/core/keys/packages.ts`, `src/core/keys/environment.ts` (283). The Vitest adapter contributes only which packages a test file reaches through Vite's resolution (`src/runners/vitest/packages.ts`, 242 lines) and reports them through `RunnerClosure.packages`; node:test reports its own set through the same field (003-22). pytest uses none of this and has its own environment rules in spec 007. The key-format guard counts all five core files as key-meaning code.

Why Core, option (a). The split is docs-only, so a section's owner should be whoever edits its code: these files are core files, and two runners consume them through one contract. Giving them to the Vitest spec would make spec 003 depend on the Vitest spec for the meaning of its keys. A spec of their own, option (b), would own paragraphs rather than files, since the rules are interleaved with the runner-neutral key code in the same modules, and nobody lands work against it. The honest cost of (a) is that a spec called runner-neutral holds npm rules. The proposal pays it by labelling the section "Node ecosystem", citing 007's equivalent so the reader sees it is per ecosystem, and noting that it can be lifted into its own spec later with no code move. Option (b) becomes right when a second ecosystem rule set exists or a third Node runner arrives.

### Q5: who owns the end-to-end proofs

Facts, corrected from section 2.2. Nine e2e files drive the shipped Claude Code bundles with recorded hook JSON against a real daemon: `lifecycle`, `policy`, `shipped-plugin`, `stop-gap`, `torn-status`, `transitions`, `worktrees`, and also 003's `node-test.test.ts` and 007's `pytest.test.ts`. Their helpers (`harness.ts`, `agree.ts`, `support.ts`, `sources.ts`, `install.ts`, `plugins.ts`) are shared with the Pi, OpenCode, pytest and node:test suites, so they are harness-neutral infrastructure. `plugin-copy.test.ts` tests the plugin tree's copy and is packaging. Core goals 1 to 4 are proven only through Claude Code's hooks today; no harness-neutral proof of a transition delivery exists.

Options.
- (a) Claude Code owns the hook-driven files; Core owns the goals they assert. Whoever changes a hook's input, output or event must update them, and that is Claude Code work. Core landings still run them, as every landing runs the whole suite.
- (b) Core owns them as test infrastructure. Core then owns files that encode Claude Code's hook JSON and plugin layout, and a hook change needs Core's acknowledgement to edit a Core-owned file.
- (c) Split by what the file encodes: the shared helpers to Core, each hook-driven scenario file to the spec whose behaviour it proves (001's seven to Claude Code, `node-test.test.ts` to 003, `pytest.test.ts` to 007), and one new Core row to add a harness-neutral proof of goals 1 to 4 (through a fake `HarnessDelivery` consumer or the CLI), so Core's goals stop depending on one harness. Recommended now that the helper facts are known: it is (a) with the infrastructure named, plus the gap made visible.


## 10. Changes on main since this proposal was written

- 2026-10-17: 0.1.203 landed (`bbad39dd`); 001-422 and 001-434 are done, review `reviews/wave-17.md` round 2 PASS. Q7's precondition is met: the docs-only migration of section 6 may start once the human gives its go. Row 001-346 no longer waits on 001-422.
- 2026-10-17: two new 001 rows, both Core by section 2.1: 001-435 (survey of issue #1's criteria 2 and 3: a scheduler that stops on an unexpected error restarts or ends the daemon; D10 and D8; endpoint a survey file and a decision for the human) and 001-436 (`squeal stop` returned 0 while the daemon's process was still exiting, main CI on `bbad39dd`; D10; endpoint the cause named and a test or product fix). Neither is dispatched. Section 5.3's row for issue #1 now reads: criterion 1 done in 0.1.203, criteria 2 and 3 are 001-435.
- 2026-10-17: this proposal and the triage convention in `docs/process.md` landed on main as docs (`8d1361c7`).

