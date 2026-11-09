# Research brief for spec 018: CI and shared results

Read `docs/vision.md` (principles 2, 5 and 8 most of all), `docs/styleguide.md`, `docs/process.md`, `docs/decisions/0002-content-keyed-shared-store.md` and `../status.md` first.

The human, 2026-10-31, three ideas that may connect, to research before anything is designed:

1. Can Squeal run tests in CI?
2. Could local Squeal import CI results back, so that what merges to main is imported and shared with team members?
3. Could a remote store be an option?

Today the store is one SQLite database under `<git-common-dir>/squeal/`, shared by the worktrees of one clone on one host (decision 0002; WAL does not work across network filesystems). A result is keyed by content: `sha256(environment hash, project, test path, (path, git blob hash) over the test file's closure)`. Commit, revision and worktree are provenance only. In principle, a key computed on a CI runner could equal the key a developer computes for the same content. Whether it does is the question the three ideas share.

The three topics run in parallel. Each owns one part, and the others stay out of it:

- `ci-run`: Squeal as the thing that runs tests in a CI job: the run mode, what it reports, and whether it may skip tests that it already knows.
- `result-import`: whether a result made elsewhere is valid here (key portability, measured), how the agent is told where a result came from, and which results may be trusted.
- `remote-store`: where shared results live and how they move: the backend, the protocol, latency, offline behaviour, write rights.

Each topic is one researcher task. Write your findings to `research/<topic>.md` in this folder. Commit when done.

## Rules for findings documents

- Length: 1 to 4 pages. Structure: Questions answered (a table), Findings per question, Recommendation, Open questions for the human, Sources.
- Mark every finding `verified by experiment`, `read in official docs`, `read in source code` or `inferred`. Name the commit you read source at.
- Prior art comes from official docs and source (Nx and Nx Cloud, Turborepo remote cache, Bazel remote cache and remote execution API, Gradle build cache, sccache, pytest-testmon, Launchable or other predictive test selection, `vitest --changed`, `jest --changedSince`). Name the version and the retrieval date. `specifications/001-core-loop/research/result-fingerprinting-prior-art.md` already covers some of this; extend it, do not repeat it.
- Read-only on GitHub: no pushes, no workflow runs, no reruns, no settings. A CI experiment is proposed as a later row with its cost, not run.
- Experiments on this host: in a fresh clone under your own `$TMPDIR`, never in the main checkout or another worktree. Stop every daemon you start (`squeal stop` in that clone) and remove the clone before you finish. No full test suite, no `squeal run --all` in this repository's worktrees. Skip any timing measurement when the one-minute load average is above the CPU count, and say so. Make no load on purpose. Never run agent CLIs (Claude, Codex, Pi, OpenCode) against your real HOME.
- Throwaway scripts live under `research/probes/<topic>/` with a README that says they are throwaway.
- Do not design the feature. Answer, measure, recommend; the coordinator writes the spec. Where the answer is "this does not fit Squeal", say so with the reason.
- Touch nothing outside `docs/specifications/018-ci-and-shared-results/research/`.

## Topic: ci-run

Can Squeal run tests in a CI job, and what would it add over the runner called directly?

1. What exists today. From source: can `squeal run` (with or without `--all`, `--wait`) run in a fresh checkout with no harness session, no prior store and no daemon left behind? What does it print, what exit code does it give on a failure, and does any machine-readable report exist (JSON, JUnit)? What breaks in an ephemeral, non-interactive environment (no git identity, a shallow clone, detached HEAD, no `$XDG_RUNTIME_DIR`, a read-only HOME)? Verify the cheap ones in a fresh clone of a small fixture repository, not of this repository.
2. What a CI user needs from it: an exit code, a report format CI systems read, logs, a time bound, sharding. Which of these Squeal has and which it lacks.
3. Skipping known results in CI. With a store carried in from an earlier run (a CI cache, an artifact, or the remote store of topic `remote-store`), Squeal could skip every test whose key already passed. How does Nx, Turborepo or Bazel decide that this is safe, and what do they do about incomplete inputs? Squeal's closure is incomplete by construction (decision 0002, consequences). A false skip in CI lets a break reach main, which costs more than a false skip on a laptop. What evidence would show it is safe enough, and which signal (runtime-observed inputs, environment hash, a full run on a schedule) would bound the risk?
4. This repository as a case. From the local store and git history only, without running tests: over the last 20 landings on main, how many of the test files kept the same key from one landing to the next, so that an import-and-skip CI would not have run them? Estimate the job-minutes saved against `specifications/010-ci-cost/research/ci-test-time.md`. Say which failures CI caught in that period (`gh run list`, read-only) and whether a skip would have hidden any.
5. Fit with the vision. Principle 5 says Squeal does not replace CI. Is "Squeal in CI" a runner wrapper, a test selector, a result producer for import, or none of these? Recommend the smallest useful form, or none.

## Topic: result-import

Can a local Squeal take results that CI (or a teammate) produced and treat them as known, and on what terms?

1. Key portability, measured. From `src/core/keys/` (`environment.ts`, `check-key.ts`, `key-format.ts`, `dependencies.ts`, `packages.ts`, `closure.ts`): what goes into the environment hash and the key, and which inputs depend on the machine: absolute paths, user, OS, CPU architecture, Node version, package manager store paths, environment variables, line endings, file modes. Then verify by experiment: compute the keys in two fresh clones of one fixture repository at different absolute paths (and, if `sudo -u squeal-e2e` is available as in memory `reference-squeal-e2e-user`, as another user). Which keys match, which differ, and why? Name the smallest change that would make keys match across machines with the same toolchain, and what it would cost in false hits.
2. What "imported" means for the agent. Vision principle 2: an old result never poses as current truth. Is a result keyed for the same content but run on another machine `current`? How should status and notices name its origin (CI run, commit, machine)? How do Nx and Turborepo report a remote hit? What about imported failures: notify, ignore, or keep only as history?
3. Which results to import. The human named "what merges to main". Which source is trustworthy enough: main pushes only, protected workflows, signed results? What is the poisoning risk (a pull request from a fork writing a pass), and how do Turborepo signatures, Nx Cloud access tokens and Bazel's remote cache handle it?
4. When to import. On `git pull` or fetch, on a new worktree's baseline (today a lookup), on a daemon start, on demand. What does an import add to the time from a new worktree to its first verdict, against today's baseline lookup?
5. Format and size. What the store holds (`src/core/store/` and the schema) and what an export for one main commit would need: results, closures, run outputs or none of the logs. Measure the size of that export from this repository's own store, read-only (copy the database to `$TMPDIR` first; never open the live store for writing).
6. Relation to existing rules: `KEY_FORMAT_VERSION`, "results survive releases" (row 011-35), held failures and baseline `lookup-only` (memory `project-cezar-lookup-only`).

## Topic: remote-store

Could the store, or part of it, live somewhere a team and its CI share?

1. Prior art, in detail: the protocol and data model of Turborepo's remote cache API, Nx Cloud and Nx's self-hosted remote cache, Bazel's remote cache (content-addressed store plus action cache) and Gradle's build cache. Where each keeps its keys and blobs, what it sends per lookup, how it batches, and how it authenticates and authorizes writes.
2. What part of Squeal's store could be remote. Split the tables (`src/core/store/`) into shared, read-mostly data (results and closures by key) and local state (worktrees, revisions, locks, per-worktree `meta`, running work). Which split keeps the daemon's hot path local?
3. Latency budget. A hook is a short-lived process, and a new worktree's baseline looks up every test file's key (about 1,358 files here). Measure the local lookup time today (read-only, a copied database). What does a remote lookup per key, or one batched request, add? What must stay true when the remote is slow or down (offline, timeouts, never blocking an agent's turn)?
4. Backend options with their cost to a user: a plain HTTP service, S3-compatible object storage, GitHub (Actions cache, artifacts, Packages, a git ref such as `refs/notes` or an orphan branch), a shared filesystem. Which needs no server the user runs? Which fits topic `result-import`'s "main only" import without a service at all?
5. Write rights and trust: only CI writes and developers read (the Nx and Turborepo pattern), or everyone writes? How does this meet vision principle 8 (anything externally visible needs explicit policy) and the secrets and environment rules?
6. Scope: does a remote store belong in Squeal, in a Hearsay service, or nowhere? Recommend the smallest form that would serve ideas 2 and 3 together, or say that the git-ref or artifact route makes a store service unnecessary.

## Topic: ci-reuse (row 018-04, the human 2026-11-01)

The human: "If Squeal and CI could run and record the store so that new PRs or reruns could actually reuse the results from earlier, that would probably shorten CI wall time a lot." Take cezarion (`hearsay-tools/cezarion`, checkout `/home/agent/projects/cezar`) as the reference for CI time: it lands through pull requests, already uses Squeal (`squeal.config.json`) and runs several Vitest projects. "Also, the research should also check whether existing tools cannot accomplish this." This topic answers both. It reuses `ci-run.md` 3 and 4; extend them, do not repeat them.

1. Cezarion's CI today, from GitHub's record (read-only): the workflows that run tests on pull requests and main, their jobs and shards, wall time and job-minutes per run (p50, p90 over the last few hundred runs, queueing apart), the test step's share, and how many runs are reruns (`run_attempt` > 1) or repeat a SHA already tested. Read its `ci-benchmark.yml` and any earlier CI-time work in its repository.
2. What reuse would save there. Replay cezarion's last 30 to 50 merged pull requests: for each PR head, which test files keep the key they had at its base on main, so that a run with main's results restored would skip them. Use the closures in a copy of its store (`git -C /home/agent/projects/cezar rev-parse --git-common-dir`, then `squeal/`; copy to `$TMPDIR`, never open the live one) and git blobs, as `probes/ci-run/same-key.mjs` did. Weight by per-file times from its CI logs. Report the saved share of test time and an estimate of wall time per run, given its sharding. Do the same for reruns of one SHA. Name the inputs that re-key the most files (as `package.json` and the test setup did here).
3. This repository with its two causes treated as fixed: the version in `package.json` (row 011-35) and the test setup's import of `src/core/types` (`ci-run.md` 4). Re-run the replay over the same 20 landings and say what share each fix frees.
4. Existing tools. Can any of these, as shipped, give a Vitest (and pytest) project per-file reuse of earlier passes across PR runs and reruns, without Squeal: Vitest's own cache and `--changed`, Vitest sharding with caching, Nx (affected, remote cache, Nx Cloud), Turborepo, Bazel, Gradle Develocity and Predictive Test Selection, Datadog Test Impact Analysis, Launchable or CloudBees Smart Tests, Buildkite Test Engine, CircleCI test splitting, `pytest-testmon` in CI, GitHub's own rerun-failed-jobs. For each: the unit it skips (task, package, file, test), what decides a skip (declared inputs, coverage, recorded reads, a model), what a project must change to adopt it, its cost (free, paid service, data leaves the repository), and whether it already does what the human describes. Where a tool already does it well enough, say so plainly.
5. GitHub cache rules, from official docs: which branches a pull-request run may restore a cache from and write to, size and eviction limits, and whether this blocks a PR from writing a result that main or another PR later reads (the Nx CVE-2025-36852 case). Also what a rerun restores.
6. The rules reuse needs to be safe enough in CI: always re-run a file whose last result failed (Bazel), a full run on main after merge or nightly, and what the release rule ("passing full-suite CI for the exact commit") then requires.
7. Recommendation: whether Squeal adds enough over the existing tools to be worth a spec, with saved wall time per PR run and per rerun, for cezarion and this repository.

Rules as above: read-only on GitHub, no CI runs or reruns; no test runs in cezarion's checkout or worktrees; a copied store only.

## Second slice topics (the human, 2026-11-09: "A: spec the useful form")

The first slice shipped `squeal export`/`import` and measured it in cezar (`import-trial.md`): 1,589 of 1,817 files current from a CI export alone; misses only from node:test's `execPath` in the key; a clone sharing a busy store gains nothing at a commit its worktrees already ran; 236 closure-list differences from the shared observed sets' union. The next slice should make the export come from the test run CI already does (no extra job), move it on a git ref, and import it without a command. Three topics, in parallel, each owning its part. CI experiments stay proposals: read-only on GitHub.

## Topic: ci-step (row 018-13)

How cezar's existing CI test step can produce an export without adding wall time. Questions: (1) Where the export could be made: run the step's Vitest under Squeal (a wrapper), or let Vitest run as today and have Squeal read what it needs afterwards (a reporter, Squeal's recorder for observed reads, Squeal's coverage provider, keys computed in a later job); what each costs in CPU and wall time, measured on this repository's suite in a fresh clone or estimated from spec 015's coverage cost and named as such. (2) Shards: how per-shard outputs combine into one export per commit. (3) `CI=true`: which resolved Vitest fields differ (`allowOnly`, `snapshotOptions.updateSnapshot`, `browser.*`, any others in Vitest 4 and 5), and whether treating them as equal for passes can ever give a wrong pass, browser mode included. (4) Node: cezar's test jobs use `lts/*` (26.x); what a project must pin, and what Squeal should say when the version differs. (5) The merge-group run is the exact SHA that becomes main: can its export be attributed to the main commit safely. Owns `research/ci-step.md`, `research/probes/ci-step/`.

## Topic: transport (row 018-14)

How one export per main commit reaches developers with no server. Questions: (1) A git ref such as `refs/notes/squeal` or `refs/squeal/<sha>` written by a CI job after the tests: which token and permissions a `merge_group` or `push` job needs, repository rulesets for such refs, concurrent writers. (2) Retention: how many commits to keep, size per commit (2.1 MB gzipped for cezar), pruning. (3) The reader: when Squeal fetches (daemon start, after `HEAD` moves, a pull), with which git command, its cost on this host's clones, and offline behaviour; it must never block a hook (principle 3). (4) Which export to import for a worktree at commit X (nearest main ancestor; several). (5) Trust: only exports written by default-branch CI of the same repository; what proves that from git alone. Owns `research/transport.md`, `research/probes/transport/`.

## Topic: key-rules (row 018-15)

The two key rules that cost matches in the trial. Questions: (1) node:test keys its environment by the absolute `execPath` (`adapter-environment.ts:70-74` at 0.1.419): what else in that environment is machine-specific; whether keying by `process.version` plus platform and arch (as Vitest's environment does) can ever give a wrong pass; what a change costs (a one-time re-key of node:test results). (2) Observed sets: the shared per-project union makes a store's closure lists larger than one CI run's. Options: accept an import when the local list is a superset of the exported list and the extra paths are only union paths (is that safe?), key a result by its own run's observed set, or prune the union. Measure on a copy of cezar's store how many files each option would match, and name any wrong-pass risk. Owns `research/key-rules.md`, `research/probes/key-rules/`.
