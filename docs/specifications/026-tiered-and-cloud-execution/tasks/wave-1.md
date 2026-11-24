# Spec 026 Wave 1 briefs (Track 1 + Track 2 scaffold)

Four disjoint rows run in parallel (`026-05`, `026-06`, `026-07`, `026-10`). Held: `026-08` (D5 `code --base`, waiting on human decision), `026-09` (D2 short-lived daemon, Wave 2 after `026-05`).

Read `docs/vision.md`, `docs/styleguide.md`, and `docs/specifications/026-tiered-and-cloud-execution/spec.md` before coding. Leave `pnpm run build` out of worker trees (the coordinator builds bundles once at integration).

---

## Row 026-05: Moment-aware runner keying (D1)

Use `/worker`.

- **Shape:** slice.
- **Outcome:** When a runner has no resolved test group at `edit` or `pause`, its runner host does not start or reopen on daemon start, content revisions, touches, observed updates, CI imports or idle import re-walks; edits re-key from stored closures/edges only, and the host opens lazily on the first explicit request (`squeal run`, Stop, `commit` group, or named path wait needing runner resolution).
- **Spec sections:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` D1; `research/tiered-pre-pr.md` Q1 (lists all 7 paths).
- **Starting seam:** Add a pure predicate (e.g. `src/core/scheduler/deferred-keying.ts`) reading resolved `checks` (via `groupView(policy)`) to determine whether runner keying is deferred for the worktree/runner. Gate `bootstrap.ts` (`readEnvironments`, `listTestFilesOf`, missing closures), `refinement.ts` (`fetchRunnerPart`), `runner-work.ts` (`queueRefine`, `queueTouched`, `queueObserved`, `queueRecheck`), `import-rewalk.ts`, and `imports-waiting.ts` when deferred; catch up pending invalidations / baseline lazily when an explicit request enters `scheduler.ts`.
- **Owns:** `src/core/scheduler/deferred-keying.ts` (new), `src/core/scheduler/bootstrap.ts`, `src/core/scheduler/refinement.ts`, `src/core/scheduler/runner-work.ts`, `src/core/scheduler/import-rewalk.ts`, `src/core/scheduler/imports-waiting.ts`, `src/core/scheduler/scheduler.ts`, and new tests under `test/scheduler/deferred-keying.test.ts` and `test/daemon/deferred-keying.test.ts`.
- **Leave alone:** `src/cli/`, `src/core/runner-host/remote/`, `src/core/lint/`, `plugins/claude-code/`.
- **Done when:**
  - Tests prove a daemon with all Vitest groups at `manual` (oxlint at `edit`) starts 0 Vitest runner hosts at start, after editing `src/` and `README.md`, after a touch, after an observed update / CI import, and after idle ticks.
  - Edits still re-key from stored closures (marking affected tests stale/unknown, never falsely current).
  - Explicit `squeal run <group>`, `run --all`, Stop required group, or `commit` group opens the runner host lazily, runs accurately, and lets `runner.hostIdleMinutes` close it again.
  - Existing scheduler/daemon tests for eager (`edit`/`pause`) policies stay green; lint, typecheck, and affected tests pass.

---

## Row 026-06: Single-process oxlint pass (D3)

Use `/worker`.

- **Shape:** slice.
- **Outcome:** Cut Squeal's oxlint provider from three oxlint spawns per pass (`--print-config`, `--debug files`, lint: ~500 ms) to one spawn on the common edit path (~80 to 120 ms) while preserving exact lint keys, ignore classification, and transition semantics.
- **Spec sections:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` D3; `research/daemonless-hooks.md` Q2, Q5; note recent `017-35` changes in `src/core/lint/provider/oxlint/{run,configs,config-set,provider}.ts` on HEAD.
- **Starting seam:** Cache resolved `--print-config` output keyed by `(oxlint_version, config_closure_blob_hashes)` in `lint.sqlite` (and in-process memory) so both warm and short-lived daemons skip `--print-config` when configs are unchanged. On `lint`, run `oxlint --format json` directly without a prior `--debug files` spawn; invoke `--debug files` only when oxlint's output accounts for fewer files than requested (ignored/excluded paths).
- **Owns:** `src/core/lint/provider/oxlint/` (`config-set.ts`, `configs.ts`, `provider.ts`, `run.ts`, `spawn.ts`, `output.ts`), `src/core/lint/store/` (additive cache table/queries if persisted in `lint.sqlite`, preserving schema migration compatibility), and tests under `test/lint/provider/oxlint/`.
- **Leave alone:** `src/core/scheduler/`, `src/cli/`, `src/core/runner-host/remote/`, `plugins/claude-code/`.
- **Done when:**
  - Tests instrument/count oxlint spawns: common edit with unchanged config runs 1 oxlint process (not 3); config blob change invalidates the cached `--print-config` immediately; ignored/excluded files still classify identically via the fallback `--debug files` path.
  - Existing `test/lint/` tests pass; lint, typecheck, and affected tests pass.

---

## Row 026-07: Narrow pre-PR run from a base ref (D4)

Use `/worker`.

- **Shape:** slice.
- **Outcome:** `squeal run <group> --base <ref> [--wait [ms]] [--json]` computes changed paths since `git merge-base <ref> HEAD` plus uncommitted/untracked working-tree edits, runs 019 D6's narrow selection for test groups (or lints changed files for lint groups), reuses current/CI-imported results, and reports honestly what was run vs left for full-group or CI runs.
- **Spec sections:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` D4; `docs/specifications/019-run-triggers/spec.md` D6 ("Narrow run").
- **Starting seam:** Parse `--base <ref>` and `--json` in `src/cli/run-group.ts` (rejecting `--base` combined with positional `<path>...` with exit 2). Create `src/cli/run-group-base.ts` to resolve merge-base and working-tree changed paths via git (reusing existing git diff helpers under `src/core/` if present), feed them into `runNarrowCommand` (`src/cli/run-group-narrow.ts`) for test groups or `runLintGroupCommand` (`src/cli/run-lint-group.ts`) for lint groups, and format text + `--json` output naming merge-base SHA, changed path count, narrow verdicts, omitted closure count, and unmatched paths. Update `src/cli/checks-text.ts` and `plugins/claude-code/skills/squeal/SKILL.md` to name `squeal run <group> --base <ref> --wait` when `manual` groups exist.
- **Owns:** `src/cli/run-group.ts`, `src/cli/run-group-narrow.ts`, `src/cli/run-group-base.ts` (new), `src/cli/run-lint-group.ts`, `src/cli/checks-text.ts`, `plugins/claude-code/skills/squeal/SKILL.md`, and `test/cli/run-group-base.test.ts`.
- **Leave alone:** `src/core/scheduler/`, `src/core/runner-host/remote/`, `src/cli/main.ts`, `src/core/lint/`.
- **Done when:**
  - Tests cover branch commits + staged/unstaged/untracked files, test-group narrow selection, lint-group `--base`, `--json` output, reuse of already-current files, honest omission counts, invalid `<ref>` (exit 2), and `--base` + positional paths error (exit 2).
  - Lint, typecheck, and affected tests pass.

---

## Row 026-10: RemoteMachineProvider seam, `ssh` + `command` providers, and `squeal remote` CLI (D6, D7.1, D7.2, D12)

Use `/worker`.

- **Shape:** slice (Wave 0 interface scaffold for Track 2).
- **Outcome:** Introduce the typed `RemoteMachineProvider` / `RemoteMachine` seam, extended `SshTarget.args`, expanded backward-compatible `remote.json` settings, built-in `ssh` and `command` providers (custom argument-list `acquire`/`wake`/`sleep`/`release` hooks for LAN/Wake-on-LAN/bespoke VMs), `$XDG_STATE_HOME/squeal/remote-machines.json` state store, and `squeal remote list|sleep|prune`.
- **Spec sections:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` D6, D7.1, D7.2, D12; `docs/specifications/021-remote-store-and-execution/spec.md` D9.
- **Starting seam:**
  1. Extend `SshTarget` in `src/core/runner-host/remote/ssh.ts` with `readonly args?: readonly string[]` passed before `destination`.
  2. Define `RemoteMachineProvider`, `RemoteMachine`, `MachineCapabilities`, `MachineRequest`, `ReleaseReason` in `src/core/runner-host/remote/provider.ts`.
  3. Implement provider registry (`src/core/runner-host/remote/providers/index.ts`), `ssh` provider (`providers/ssh.ts`), and `command` provider (`providers/command.ts`, spawning argument lists only, never shell strings, passing `SQUEAL_*` env vars, parsing `{ v: 1, id, destination, sshArgs?, node?, cache?, hasGitRepository?, sleepOnIdle?, ephemeralHostKey?, state? }`).
  4. Expand `src/core/runner-host/remote/settings.ts` with `provider`, `providerConfig`, `runners`, `lanes`, `planning`, `coverage`, `environmentMode`, `idleSleepMinutes`, `diskCheck` while preserving full backward compatibility for `{ target: "..." }` entries; wire provider acquisition in `src/core/runner-host/remote/daemon-lane.ts` and `connect.ts`.
  5. Add `src/core/runner-host/remote/machines-store.ts` (`$XDG_STATE_HOME/squeal/remote-machines.json`) and `src/cli/remote.ts` (`squeal remote list [--json] | sleep [<worktree>] | prune [--dry-run]`), wired into `src/cli/main.ts`.
- **Owns:** `src/core/runner-host/remote/ssh.ts`, `src/core/runner-host/remote/settings.ts`, `src/core/runner-host/remote/provider.ts` (new), `src/core/runner-host/remote/machines-store.ts` (new), `src/core/runner-host/remote/providers/` (new), `src/core/runner-host/remote/connect.ts`, `src/core/runner-host/remote/daemon-lane.ts`, `src/cli/remote.ts` (new), `src/cli/main.ts`, `test/runner-host/remote/`, `test/cli/remote.test.ts`.
- **Leave alone:** `src/core/scheduler/`, `src/cli/run*.ts`, `src/core/lint/`, `plugins/claude-code/`.
- **Done when:**
  - Existing `remote.json` `{ target }` configs keep working identically through the `ssh` provider.
  - `command` provider tests exercise real fake scripts for `acquire`, `wake`, `sleep`, `release(reason)`, non-zero exit, bad JSON, and timeout without touching real `HOME` or `~/.ssh`.
  - `squeal remote list [--json]`, `sleep`, and `prune [--dry-run]` tests pass against a temp `$XDG_STATE_HOME`.
  - Lint, typecheck, and affected tests pass.
