# Research brief for spec 026: tiered local checks and cloud sandboxes

Read `docs/vision.md`, `docs/styleguide.md`, `docs/process.md`, `docs/decisions/0002-content-keyed-shared-store.md`, and `../status.md` first.

The human, 2026-11-23, wants to research two non-exclusive directions in parallel:

> "So the idea could be:
> - cheap stuff runs on edit
> - heavy stuff runs manually (or on edit - subject to configuration) or in cloud"

1. **`tiered-pre-pr`**: keep cheap feedback on edit (complexity, cheap lint) and move heavy test execution to manual / Stop / pre-PR selective runs backed by CI imports (`refs/squeal/<sha>`).
2. **`boat-sandboxes`**: run every worktree's heavy test execution (or its whole daemon, all tiers and runners, not just Vitest catch-up) in its own `boat.dev` sandbox, revisiting file sync options including Mutagen.

Each topic is one researcher task. Write your findings to `research/<topic>.md` in this folder and commit them with any throwaway probes. Neither topic reads the other's file.

## Rules for findings documents

- Length: 1 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code`, or `inferred`. Name the commit you read source at and, for outside tools, the version and retrieval date.
- Sources: official docs, this repository, and copies of local stores under `$TMPDIR` (read-only). Do not search the open web beyond named tools' official docs. Where a source does not answer a question, write "not determined, because".
- Private material rule (`docs/styleguide.md`): never commit absolute home paths (write `~`), recorded agent session logs or transcripts, or names of private client repositories. Run `pnpm run check:private` on your changes if unsure.
- No em-dashes. Short sentences. Data over adjectives.
- Experiments on this host: in a fresh clone or fixture under `$TMPDIR`, never in the main checkout or another live worktree. Read live stores only by copying them to `$TMPDIR` first and opening read-only. Stop every daemon you start (`squeal stop`) and clean up temp fixtures before finishing. No full test suite and no `squeal run --all` in this repository's worktrees.
- Load: this host is shared. Make no unnecessary load. Skip local timing measurements when the one-minute load average exceeds 24, retry once later, and otherwise report as not measured with the load observed. Report host load beside every local timing you keep.
- Throwaway scripts live under `research/probes/<topic>/` with a `README.md` that marks them throwaway. Keep `node_modules` out of git.
- Do not design the full feature or edit `docs/board.md`, `spec.md`, or product code. Touch nothing outside `docs/specifications/026-tiered-and-cloud-execution/research/`.

---

## Topic: tiered-pre-pr

Earlier files to read and extend (do not repeat):
- `../../011-core/research/manual-mode.md`
- `../../018-ci-and-shared-results/research/live-saving.md` and `../../018-ci-and-shared-results/status.md` (especially row 018-52: 99% export coverage in Squawk)
- `../../019-run-triggers/spec.md` and `../../019-run-triggers/research/runner-trigger.md`
- `../../020-quality-gate/spec.md`
- `../../015-coverage-complexity/spec.md` and `../../017-lint-checks/spec.md`

Questions to answer:

1. **What happens today when all test groups are off `edit`?** Trace in source (`src/core/daemon/`, `src/core/scheduler/`, `src/core/runner-host/`, `src/core/code/`, `src/core/lint/`): if a repository sets every test group to `at: "manual"` or `at: "stop"`, keeps `complexity.enabled: true` and a cheap linter (`oxlint` or `biome`) at `edit`, and sets `shared.ref`:
   - Does a daemon still start or wake Vitest / node:test runner hosts on start, on edit, or on CI import (for `affected`, closures, or keying)? That is the decisive cost question: if zero edit-time tests still wakes a 1 to 2 GB Vitest host on edits, name every code path that triggers it.
   - Does complexity counting and cheap linting work on edit without any runner host running?
   - Verify with a small fixture experiment under `$TMPDIR` (or measure daemon RSS, open runner hosts, and hook latency on edits when no test group is at `edit`).
2. **Intermediate churn vs final branch delta (measured on store copies).** Copy `~/projects/squeal/.git/squeal/store.sqlite` and `~/projects/cezar/.git/squeal/store.sqlite` (read-only copies in `$TMPDIR`, if present) and read recent git history / worktree runs:
   - What share of Squeal's local test CPU is spent re-running tests on intermediate edits during a session vs running the final set of tests affected by a branch/PR diff?
   - Against recent CI exports (`refs/squeal/<sha>`), for real recent merged PRs or commits (sample 20 to 30 commits on main in Squeal and Squawk if available), how many test files does CI import settle as current, how many must run before opening the PR, and what is the estimated wall/CPU time of that pre-PR selective run vs a full suite vs live edit-time daemons?
3. **Current pre-PR command and UX gaps.** Compare what an agent or developer would actually run before opening a PR today:
   - `squeal run <group> --wait` (runs all non-current files in the group, relying on CI import to make untouched files current)
   - `squeal run <group> <paths>... --wait` (narrow run)
   - `squeal code --base origin/main` (checks changed JS/TS functions for CC and CRAP, no daemon required)
   - Name the exact gaps: e.g. does `squeal code --base` miss non-JS/TS changes or test-only regressions outside changed functions? Does `refs/squeal/<sha>` lacking coverage records force `squeal code --base` to re-run affected tests anyway (and is that actually fine because only affected tests run)? What happens on macOS laptops where CI's Linux x64 environment descriptor does not match?
4. **What is lost by dropping edit-time test push?** From `../../006-model-evals/`, `../../011-core/research/manual-mode.md`, and `../../019-run-triggers/research/runner-trigger.md`: summarize the measured value of edit-time `PASS -> FAIL` push (regressions caught mid-task, turns saved, late rework avoided) and how much of that value cheap on-edit checks (complexity + cheap lint) retain vs lose.
5. **Cheap-on-edit / heavy-on-demand product shape.** Recommend the cleanest configuration and CLI shape for "cheap checks on edit, heavy tests on demand or pre-PR" (including any daemon/runner-host fixes required so an edit-free test policy truly uses near-zero RAM/CPU), or state plainly if today's `checks` config is already sufficient.

---

## Topic: boat-sandboxes

Earlier files to read and extend (do not repeat):
- `../../021-remote-store-and-execution/research/remote-execution.md` (Mutagen v0.18.1 findings Q3/Q6; boat.dev docs Q5)
- `../../021-remote-store-and-execution/research/runner-split.md`
- `../../021-remote-store-and-execution/research/boat-trial.md` (first boat.dev trial, defects D1 to D5, especially D5 `ascii-lazyfs`)
- `../../021-remote-store-and-execution/spec.md` and `src/core/runner-host/remote/`
- `bench/README.md` and `bench/boat-run.sh`

**Budget and safety for live `boat.dev` experiments (authorized by the human, 2026-11-23):**
- Check `boat limits --all` first. Keep total sandbox starts to at most 6 and total spend well under $0.50 of plan hours.
- Always pass `--no-env` when creating sandboxes so no account secrets enter them.
- Always delete every sandbox and temporary snapshot you create before finishing (`boat delete <id> --yes`, `boat snapshots` check). Verify `boat list` shows none of your sandboxes left.
- Never read, echo, or commit credentials.

Questions to answer:

1. **Architecture comparison: 2A vs 2B vs hybrid.**
   - **2A**: Thin local daemon per worktree (keeps local shared SQLite store, fast < 80 ms hooks, cheap local complexity/lint on edit) + per-worktree boat.dev runner hosts for ALL test tiers and runners (edit, catch-up, slow, Vitest, node:test, pytest).
   - **2B**: Full Squeal daemon inside each per-worktree boat.dev sandbox (local host only runs thin hooks + file sync).
   - Compare on: local CPU/RAM, hook latency vs 2 s hook timeout, cross-worktree store reuse (Decision 0002), CI import reuse (including **macOS / non-Linux laptops** where local OS differs from Linux x64 CI and boat.dev!), `squeal status --at` / `squeal proof`, coverage transport, and failure/offline behavior.
2. **Experiment A: Warm repo snapshot + `boat fork` startup time and `.git` tests.**
   - Create one `default` (4 vCPU, 8 GB) sandbox with `--no-env`, install matching Node (26.13.0) + corepack/pnpm, push this repository (including `.git` so git-dependent tests work, or clone/push bundle), run `pnpm install`, then snapshot/stop it.
   - Fork a child sandbox from it (`boat fork`) and measure:
     - Fork-to-SSH-ready wall time (compare against `boat-trial.md`'s 44 to 52 s cold connect).
     - Time to apply a 10-file uncommitted delta over SSH.
     - Run 3 of the Git-dependent test files that failed in `boat-trial.md` D2 (e.g. ones calling `git rev-parse HEAD` / `git ls-files`) to verify `.git` in the forked sandbox fixes D2 cleanly.
3. **Experiment B: `ascii-lazyfs` disk sync performance (`boat-trial.md` D5).**
   - Measure 4 KiB `dsync` write latency (as in `boat-trial.md` D5) and a 10-file Vitest run of `test/capacity/` (file-locking/sync-heavy tests) on:
     1. the fresh sandbox,
     2. the `boat fork` sandbox immediately after fork,
     3. the forked sandbox after a short warm-up / second run, and (if cheap) a stopped-and-resumed sandbox.
   - Answer clearly: does `boat fork` suffer D5's 20 to 30x `dsync` slowdown, or is it fast?
4. **Experiment C: End-to-end edit-to-verdict latency for ALL tiers (not just catch-up).**
   - Over a kept SSH connection (and compare `boat exec` vs kept SSH `ControlMaster`), measure latency on the forked sandbox for:
     - 1-file warm Vitest edit run (sync delta + invalidate + affected + blob proof + run)
     - 10-file warm Vitest edit run
     - 1-file `node:test` run
     - Check whether running Squeal's coverage provider on the sandbox and mapping payloads remotely to compact relative records (`CoverageRecord` ~25 KiB/file) is fast enough for edit tiers.
5. **File sync revisited: Mutagen vs Squeal delta sync vs `boat push`.**
   - Extend `021/research/remote-execution.md` Q3/Q6 specifically for both 2A and 2B.
   - If the whole daemon lives in the sandbox (2B), does Mutagen's case improve or do its defects (no `.gitignore` reading / `.env` leak, 10 s Linux polling on cold files, `flush` returning 0 on stale/missing files, silent hung remote, SSPL/maintenance) still disqualify it compared to a thin local git-aware watcher sending deltas + blob IDs over a kept SSH pipe?
   - Also check `boat push` behavior and speed for incremental updates.
6. **Cost, limits, sizing, and lifecycle.**
   - Read `boat limits --all` and `boat.dev` CLI/docs for exact concurrency limits, start rate limits, `small` (2 vCPU / 4 GB) vs `default` (4 vCPU / 8 GB) pricing and RAM fit for one Squeal or Squawk worktree daemon, idle auto-stop, snapshot retention/limits, and host-key behavior across `boat ssh` / `fork` / `resume`.
   - Model monthly cost for (a) a solo developer (2 to 3 worktrees, 8 h/day, idle auto-stop after 15 min) and (b) a busy coordinator host (10 to 15 concurrent worktrees).
7. **Gap inventory in `src/core/runner-host/remote/` and recommendation.**
   - List what must change in Squeal to run ALL tiers, ALL runners, and coverage on per-worktree boat.dev sandboxes (and how `compareEnvironment` handles macOS local -> Linux remote).
   - Recommend 2A, 2B, or a hybrid (e.g. local thin daemon with cheap edit checks + boat.dev sandbox for all heavy test execution), with the decisive trade-offs, risks, and open questions for the human.

---

## Topic: daemonless-hooks (round 2, the human, 2026-11-24)

Earlier files to read and extend (do not repeat):
- `tiered-pre-pr.md` (in this folder: complexity and oxlint work on edit without a runner host, hook latency 98 to 134 ms, live daemons hold 350 to 630 MB each plus 0.5 to 1.1 GB Vitest host)
- `../../021-remote-store-and-execution/research/daemon-heap.md` and `daemon-model.md`
- `../../015-coverage-complexity/spec.md` and `../../017-lint-checks/spec.md` and `../../017-lint-checks/research/oxlint-provider.md`
- `bench/README.md` (hook latency limits: 80 ms p95 healthy, 200 ms warn, 2,000 ms hard timeout gate)

Questions to answer:

1. **What complexity and lint need from the daemon today.** Trace `src/core/daemon/daemon.ts`, `src/core/code/`, `src/core/lint/`, and `src/harness/shared/`: what state must survive between edits (transition deduplication, consumer views, `code.sqlite` / `lint.sqlite`, `squeal status`, commit reports) and what breaks if no daemon runs for a worktree?
2. **Inline hook latency experiment.** Under `$TMPDIR` (report host load; skip timings if load > 24), measure cold-start + run time of a standalone process (simulating `PostToolBatch` with no daemon) for:
   - tree-sitter complexity count on 1, 3, and 5 real TypeScript files from this repository (including WASM load time);
   - `oxlint` on 1, 3, and 5 real TS files;
   - `eslint` on 1 real TS file (if configured, or cite `017` measurements);
   - reading/writing transition state in SQLite directly.
   Compare directly against the 80 ms p95 healthy / 200 ms warn / 2,000 ms hard timeout hook limits.
3. **Why is today's daemon 350 to 630 MB without a runner host?** Measure on a clean fixture and/or inspect `daemon-heap.md` and source (`WorktreeKeys`, tree-sitter WASM, SQLite connections, bundled code): when all test groups are `manual` and moment-aware keying never opens a runner host or loads test closures, how much RSS does a daemon actually hold?
4. **Three architectures compared:**
   - **(A) Inline daemonless hooks:** complexity + oxlint run directly inside `PostToolBatch` (zero idle RAM, zero background processes).
   - **(B) Fire-and-exit helper:** `PostToolBatch` returns immediately after reading stored transitions (< 80 ms) and spawns a short-lived detached worker that counts complexity + runs oxlint on changed files, writes `code.sqlite`/`lint.sqlite`, and exits (zero idle RAM, fast hooks, results arrive on next hook).
   - **(C) Slim daemon (or one shared cheap-checks daemon per clone) with moment-aware keying:** keeps persistent WASM + watcher + fast hooks, without runner hosts or test closures.
   Compare on: hook latency, idle RAM across 1 and 12 worktrees, CPU per edit, external edits (git pull / human edits outside agent tools), `eslint` support, `squeal status`, and implementation scope.
5. **Recommendation:** pick (A), (B), or (C) with measured numbers, concrete trade-offs, and open questions for the human.

---

## Topic: agent37-sandboxes (round 2, the human, 2026-11-24)

Earlier files to read and extend (do not repeat):
- `boat-sandboxes.md` and `probes/boat-sandboxes/` (in this folder: exact probes `dsync.sh`, `driver.mjs`, `run-tests.sh`, `setup-node.sh` so measurements are apples-to-apples with boat.dev)
- Official Agent37 docs: `https://www.agent37.com/docs/llms.txt`, `/docs/agents-api/{billing,instance-sizing,vm-instances,ssh,instance-auto-sleep,instances/create,instances/fork}.md`

**Budget and safety for live Agent37 experiments (authorized by the human, 2026-11-24; uses `agent-vault` proxy to `api.agent37.com` and `sandbox.agent37.app`, never print or store credentials):**
- Check `GET /v1/billing` first. Keep total spend well under $0.50 and delete every instance and temporary SSH key you create before finishing (`GET /v1/instances` must return empty `data: []`).
- Compare apples-to-apples against `boat-sandboxes.md` on 4 vCPU / 8 GB shapes across available types:
  1. US `default` (gVisor, $0.0128/h),
  2. EU `vm` (Full VM, ~$0.0309/h),
  3. EU `performance` (dedicated-core VM, ~$0.049/h) if funded and cheap.

Questions to answer:

1. **Create, fork, and sleep/wake timings.** Measure cold create time, `POST /v1/instances/{id}/fork` time from a warm instance (with `.git` and `node_modules`), and `auto_sleep` wake latency. Verify whether `eu` rejects `"type": "default"` with `400 invalid_request` as documented.
2. **Disk sync (`dsync`) and `test/capacity`.** Run the exact `dsync.sh` (200 x 4 KiB `oflag=dsync`) and 10-file `test/capacity` Vitest run from `probes/boat-sandboxes/` on each tested type (US `default` gVisor, EU `vm`, EU `performance`). Compare directly against boat.dev 9950X (0.14 ms flush, 1.9 s) and 9700X (34 to 38 ms flush, 26 to 72 s with timeouts).
3. **End-to-end edit-to-verdict latency over SSH (`ProxyCommand agent37 tunnel`) and `exec`.** Run `probes/boat-sandboxes/driver.mjs` (1-file Vitest, 10-file Vitest, 1-file source edit, coverage off/on, 1-file `node:test`, plus the 3 Git-dependent D2 test files) on each tested type. Note RTT, SSH tunnel stability, and whether `ProxyCommand agent37 tunnel` works cleanly with `ControlMaster` and `squeal runner-host` stdio framing.
4. **CPU consistency and throttling.** On US `default` (gVisor) vs EU `vm` (shared cores) vs EU `performance` (dedicated cores), check `/proc/cpuinfo`, sustained CPU behavior across a 50-file Vitest slice, and whether gVisor syscall overhead or throttling breaks or slows Squeal's tests (including `nice`, process groups, SQLite WAL, `fs.watch`, `realpath`).
5. **Cost, limits, and recommendation against boat.dev.** Compare monthly cost (solo 3 worktrees; coordinator 12 worktrees with `auto_sleep`), limits (concurrent awake RAM vs boat.dev's 200 starts/day), EU data residency, and recommend boat.dev vs Agent37 (and which type) vs provider-agnostic SSH driver.
