# Spec 026 Wave 1.5 repair briefs (review `reviews/0.1.616.md`)

Fixes all seven proven blockers (B1 to B7) and both plausible notes (S1, S2) from `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.616.md`. B6 (`SKILL.md` budget and `test/cli/code-gate-args.test.ts`) is fixed on HEAD before dispatch; four repair workers fix B1+B2, B3, B4+B5, and B7+S1+S2 in parallel.

Read `docs/specifications/026-tiered-and-cloud-execution/reviews/0.1.616.md`, `spec.md`, `docs/vision.md`, and `docs/styleguide.md`. Do NOT run `pnpm run build` or a local full suite.

---

## Repair 026-r1: Per-runner deferral (B1) and fresh named-wait wake (B2)

Use `/worker`.

- **Shape:** repair.
- **Outcome:** Enforce D1 deferral per runner (`vitest`, `node-test`, `pytest`) rather than globally, so an eager `node-test` or `pytest` group never wakes a `manual`-only `vitest` runner on start or background revisions; and make a fresh named `status --wait <path>` with no stored listing wake the relevant deferred runner(s) before selecting files while keeping unnamed `status` and background sync cheap.
- **Findings:** `reviews/0.1.616.md` B1 (`deferred-keying.ts:50`, `scheduler.ts:670`) and B2 (`scheduler.ts:961`).
- **Starting seam:**
  - B1: Replace the global `CHECK_RUNNERS.every(...)` gate with per-runner deferral. Either wrap each member runner in `src/core/daemon/composite-runner.ts` / `daemon.ts` or track per-runner owed work (`OwedRunnerWork` per runner name) in `src/core/scheduler/deferred-keying.ts` and `scheduler.ts` so `environment`, `testFiles`, `closure`, `invalidate`, `affected`, `recheck`, and `importRewalk` never reach a deferred runner until an explicit request for that runner arrives. An explicit request for an eager group's files must not wake unrelated deferred runners.
  - B2: When a named `status --wait <path>` (`src/cli/named-listing.ts` / `status-wait*`) sees no stored listing (or unkeyed deferred state), send a named-resolution wake (e.g. `wake: true` on `sync` or dedicated request) so the daemon opens the relevant deferred runner(s), runs its owed baseline/refinement, and lists files before selection/promotion. Unnamed `status` and background sync stay host-free.
- **Owns:** `src/core/scheduler/deferred-keying.ts`, `src/core/scheduler/bootstrap.ts`, `src/core/scheduler/refinement.ts`, `src/core/scheduler/runner-work.ts`, `src/core/scheduler/imports-waiting.ts`, `src/core/scheduler/scheduler.ts`, `src/core/daemon/composite-runner.ts`, `src/cli/named-listing.ts`, `src/cli/status-wait*.ts` (if touched), plus minimal additive wiring in `src/core/types/daemon.ts`, `src/core/daemon/socket.ts`, `src/core/daemon/daemon.ts`, and tests in `test/scheduler/deferred-keying.test.ts` and `test/daemon/deferred-keying.test.ts`.
- **Leave alone:** `src/core/lint/`, `src/cli/run-group*`, `src/cli/remote.ts`, `src/core/runner-host/remote/`, `plugins/`.
- **Done when:**
  - Mixed-runner test proves `vitest` (`manual`) gets 0 calls (`environment`, `testFiles`, `closure`, `invalidate`) at start and on edits while `node-test` (`edit`) runs normally (and similarly for `pytest`), and explicit `node-test` requests do not wake `vitest`.
  - Real-daemon / CLI tests prove a first-ever `status --wait <test-path>`, first-ever `status --wait <src-path>`, and a newly added test after deferred start wake the deferred runner and return verdicts, while unnamed `status` leaves 0 runner hosts.
  - Lint, typecheck, and targeted scheduler/daemon/named-wait tests pass.

---

## Repair 026-r2: Single oxlint spawn on unseen included paths (B3)

Use `/worker`.

- **Shape:** repair.
- **Outcome:** Under warm unchanged configs, a normal `refresh -> inputs -> lint` pass on a newly edited/unseen included path spawns only `['lint']` (1 oxlint process), never `['debug-files', 'lint']`; `--debug files` runs only when the lint report accounts for fewer files than requested (ignored/excluded paths).
- **Findings:** `reviews/0.1.616.md` B3 (`src/core/lint/provider/oxlint/provider.ts:127`, `:274`).
- **Starting seam:** In `src/core/lint/provider/oxlint/provider.ts`, stop calling `linted()` (`--debug files`) eagerly inside `inputs()` for unseen paths when the config cache is warm and the path has a supported extension; let `inputs()` compute the key from the warm config closure and defer ignore classification to `lint()`'s existing fewer-files fallback (saving the ignored/linted memo from `lint()`'s actual report and fallback `--debug files`), while preserving exact lint keys, ignore classification, and config-change invalidation.
- **Owns:** `src/core/lint/provider/oxlint/` (`provider.ts`, `cache.ts`, `config-set.ts`, `run.ts`, `output.ts`), `test/lint/provider/oxlint/spawns.test.ts`, `test/lint/provider/oxlint/cache-store.test.ts`.
- **Leave alone:** `src/core/scheduler/`, `src/core/lint/pass/`, `src/cli/`, `src/core/runner-host/remote/`, `plugins/`.
- **Done when:**
  - `spawns.test.ts` reproduces the reviewer's exact probe: warm config + `src/a.js`, then normal `refresh -> inputs -> lint` on unseen included `src/b.js` under unchanged config records `['lint']` only (1 spawn).
  - Config-change re-reads config and classifies ignores accurately; fewer-files fallback classifies ignored/excluded files identically and caches the answer.
  - All `test/lint/provider/oxlint/` tests, lint, and typecheck pass.

---

## Repair 026-r3: Path-scoped lint `--base` (B4) and final per-file JSON verdicts (B5)

Use `/worker`.

- **Shape:** repair.
- **Outcome:** (B4) `squeal run <lint-group> --base <ref>` constrains daemon lint execution and waiting strictly to the merge-base changed paths matching the group's rules (never linting unrelated pending files or inheriting their failures); (B5) `squeal run <test-group> --base <ref> --wait --json` reports final post-wait per-file verdicts keyed by `(project, path)` alongside initial request provenance.
- **Findings:** `reviews/0.1.616.md` B4 (`src/cli/run-group-base.ts:96`, `:220`) and B5 (`src/cli/run-group-base.ts:170`).
- **Starting seam:**
  - B4: Carry optional `paths?: readonly RelativePath[]` on lint `run-group` (or `run-group-paths` for lint groups) through `src/core/daemon/run-group.ts` and `src/core/lint/pass/` so only matching changed paths are prioritized/linted and waited on for the verdict; preserve ordinary whole-group `squeal run <lint-group>` unchanged.
  - B5: In `src/cli/run-group-base.ts`, keep initial request disposition (`initialState` / `initialCurrent` / `queued`) separate from final post-wait per-file verdicts (`verdict`: `"passed" | "failed" | "not-finished" | "unknown"`, `from`: `"store" | "run" | null`) read from a consistent store snapshot keyed by `(project, path)` (never `path` alone).
- **Owns:** `src/cli/run-group-base.ts`, `src/cli/run-lint-group.ts`, `src/cli/run-group-narrow.ts`, `src/core/daemon/run-group.ts`, `src/core/lint/pass/` (path-scoped lint group request only), plus minimal additive wiring in `src/core/types/daemon.ts`, `src/core/daemon/socket.ts`, `src/core/daemon/daemon.ts`, and `test/cli/run-group-base.test.ts` (plus unit tests for path-scoped lint pass).
- **Leave alone:** `src/core/lint/provider/oxlint/`, `src/core/scheduler/`, `src/cli/remote.ts`, `src/core/runner-host/remote/`, `plugins/`.
- **Done when:**
  - Lint `--base` tests prove: one changed matching file lints and counts, one changed non-matching file is ignored, and an unrelated pending failing file neither runs for this request nor flips its verdict.
  - `--base --wait --json` tests prove: fresh success reports final `passed` (not `"queued"`), partial timeout distinguishes completed vs `not-finished`, current reuse distinguishes `store` vs `run`, and two Vitest projects sharing one test path never cross-contaminate failure flags.
  - Lint, typecheck, and targeted CLI + lint-pass tests pass.

---

## Repair 026-r4: Remote sleep channel-close/wake ordering (B7), locked machine store (S1), and lazy remote connect when deferred (S2)

Use `/worker`.

- **Shape:** repair.
- **Outcome:** (B7) `squeal remote sleep` routes through a live owning daemon to close idle remote SSH channels first (refusing honestly if a run is in flight), invokes `machine.sleep()`, does not mark static `ssh` no-op hosts `"sleeping"`, and guarantees the next run calls `machine.wake()` before reconnecting; (S1) `remote-machines.json` uses a cross-process lock around read-modify-write; (S2) `withRemoteLane` skips eager constructor `connect()` when the runner is deferred by moment policy.
- **Findings:** `reviews/0.1.616.md` B7 (`src/cli/remote.ts:106`, `daemon-lane.ts:113`), S1 (`machines-store.ts:92`), S2 (`daemon-lane.ts:106`, `lane.ts:393`).
- **Starting seam:**
  - B7: Add a `sleep()` method on the remote lane handle (closing idle SSH channels and transitioning the lane out of `ready` so the next run calls `wake()` + reconnect; returning a busy reason if a run is in flight) and expose a `remote-sleep` daemon socket request. `squeal remote sleep` queries the live daemon first (falling back to `reattach` when no daemon runs) and checks `machine.capabilities.sleepOnIdle` so static `ssh` hosts report a clear no-op instead of falsely writing `"sleeping"`.
  - S1: Wrap `machines-store.ts` mutations with a lockfile (`O_CREAT | O_EXCL` with retry and stale-lock recovery) beside `remote-machines.json`.
  - S2: Pass `eager?: boolean` (default `true`; `false` when `runnerKeyingDeferred(policy, "vitest")` is true) into `withRemoteLane` so deferred policies do not call `connect()` in the constructor; first real run connects lazily.
- **Owns:** `src/core/runner-host/remote/lane.ts`, `src/core/runner-host/remote/daemon-lane.ts`, `src/core/runner-host/remote/machines-store.ts`, `src/core/runner-host/remote/provider.ts`, `src/core/runner-host/remote/providers/ssh.ts`, `src/cli/remote.ts`, plus minimal additive `remote-sleep` wiring in `src/core/types/daemon.ts`, `src/core/daemon/socket.ts`, `src/core/daemon/daemon.ts`, and tests in `test/runner-host/remote/` and `test/cli/remote.test.ts`.
- **Leave alone:** `src/core/scheduler/` (read-only import of `runnerKeyingDeferred` allowed), `src/core/lint/`, `src/cli/run-group*`, `plugins/`.
- **Done when:**
  - Tests prove: channel close happens strictly before `machine.sleep()`; busy in-flight run refuses sleep honestly and does not mark `"sleeping"`; next run after sleep calls `machine.wake()` and reconnects; static `ssh` reports no-op without marking `"sleeping"`; no-daemon sleep still works via `reattach`.
  - Two-process concurrent writer test against `machines-store.ts` loses zero records.
  - Deferred/manual-only policy does not call `acquire`/`connect` at `withRemoteLane` construction.
  - Lint, typecheck, and targeted remote + CLI tests pass.
