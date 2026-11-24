# Spec 026 Wave 6 brief (final closeout polish)

Wave 6 closes the three defects (`D1`–`D3`) and one observation (`O1`) uncovered by row `026-16`'s end-to-end proof and live Agent37 EU `vm` dogfooding (`docs/specifications/026-tiered-and-cloud-execution/lessons.md`), so Spec 026 satisfies Vision Principle 2 and D12.1/D12.2 before moving to `shipped`.

---

## Row 026-20: Close `lessons.md` D1–D3 and O1 (honest refused-remote `status`, D12.1/D12.2 `status`/`ps`, refused wording, abort-safe `agent37` `acquire`)

- **Role:** `/worker` (`claude` `opus` `high`)
- **Spec:** `docs/specifications/026-tiered-and-cloud-execution/spec.md` (D7.3, D11, D12.1, D12.2), `docs/specifications/026-tiered-and-cloud-execution/lessons.md` (D1, D2, D3, O1), `docs/vision.md` (Principle 2: say what is unknown)
- **File ownership:**
  - `src/core/daemon/bootstrap.ts` (and/or `src/core/scheduler/scheduler.ts` if needed for listing-failed state when remote planning fails under `whenLost: "not-run"`)
  - `src/core/types/status.ts`, `src/core/status/snapshot.ts`, `src/core/status/format-status.ts`, `src/core/status/checks.ts` (and a small helper module under `src/core/status/` if clean)
  - `src/core/types/store.ts` ONLY if a new `WORKTREE_META_ROWS` key is needed (if you can reuse existing notes/store state cleanly without adding a meta row, prefer that; if a structured meta row is cleaner, register it in `WORKTREE_META_ROWS` and run `test/store/worktree-meta.test.ts`)
  - `src/core/ps/shape.ts`, `src/core/ps/model.ts`, `src/core/ps/processes.ts`, `src/core/ps/snapshot-shape.ts`, `src/core/ps/render.ts`
  - `src/core/runner-host/remote/lane.ts`, `src/core/runner-host/remote/daemon-lane.ts`, `src/core/runner-host/remote/machine-share.ts`
  - `src/core/runner-host/remote/providers/agent37/index.ts`, `src/core/runner-host/remote/providers/agent37/api.ts` (if `signal` threading is needed)
  - Tests: `test/e2e/spec-026-remote.test.ts`, `test/runner-host/remote/providers/agent37.test.ts`, `test/runner-host/remote/lane*.test.ts`, `test/status/*.test.ts`, `test/ps/*.test.ts`
  - Docs: `docs/specifications/026-tiered-and-cloud-execution/lessons.md` (update D1–D3 and O1 status once fixed & verified)
  - **Do NOT edit:** `docs/board.md`, `docs/specifications/026-tiered-and-cloud-execution/status.md`, `package.json`, `plugins/*/dist/*`.

### Concrete requirements

#### 1. D1 (Vision Principle 2, D12.1): Honest plain `squeal status` when remote planning is refused/unreachable under `whenLost: "not-run"`

- **Current defect:** When `planning: "remote"` and `whenLost: "not-run"` and the remote is refused at connect (for example slow disk under `onSlowDisk: "refuse"` or arch mismatch under `environmentMode: "match-local"`), `testFiles()` rejects with `"remote <target> refused ...; not planned here (whenLost \"not-run\")"`, yet plain `squeal status` prints:
  - `"Known failures: 0; the daemon listed no test files"`
  - `"Full-suite checkpoint: completed at revision 0"`
  and no line outside `status --full` notes names the refusal.
- **Required fix:**
  - When startup / revision listing fails for a runner because `testFiles()` threw (including refused/unreachable remote under `whenLost: "not-run"`), do NOT mark the worktree as cleanly listed with 0 test files and a completed full-suite checkpoint!
  - Plain `squeal status` must NOT say `"the daemon listed no test files"` or `"Full-suite checkpoint: completed at revision 0"` in that state; it must honestly report that test files could not be listed (and plain `squeal status`'s `Remote:` line — requirement 2 below — names the refusal/unreachable reason directly!).
  - Check existing status/bootstrap tests so normal empty repositories (0 test files with a healthy runner) keep their existing behavior unchanged.

#### 2. D2 (D12.1 & D12.2): Remote summary in plain `squeal status` and `squeal ps`

- **D12.1 (`squeal status`):** Whenever a remote lane is configured/active on the worktree, plain `squeal status` prints a concise `Remote:` line (outside `--full`) naming:
  - provider kind and machine id (or target when static `ssh` / not yet acquired),
  - state (`awake`, `sleeping`, `connecting`, `degraded-disk`, `refused`, `unreachable`),
  - configured lanes and runners,
  - planning mode (`remote`/`local`),
  - environment mode (`match-local`/`remote-key`, plus remote machine description when active),
  - last proof time (when proven) or the refusal/degraded-disk reason (when refused/degraded-disk/unreachable).
  - Keep it clean and terse (one line per configured remote or one concise `Remote:` line; zero noise when no remote is configured!).
- **D12.2 (`squeal ps`):** Update `squeal ps` (`src/core/ps/*`) so remote runner hosts under their daemon show **provider, machine id, and state (`awake`/`sleeping`)** when a matching remote machine is tracked in `$XDG_STATE_HOME/squeal/remote-machines.json` (or recorded by the daemon), instead of only `remote <target> (ssh)`. When no tracked machine matches (for example legacy static `ssh`), keep the clean fallback `remote <target> (ssh)`. Preserve `squeal ps --json` schema compatibility (additive optional fields only).

#### 3. D3 (`src/core/runner-host/remote/lane.ts:553`): Accurate refused vs unreachable wording

- **Current defect:** `instead()` in `src/core/runner-host/remote/lane.ts:553` always returns:
  `remote ${target} unreachable; not run here (whenLost "not-run")`
  even when the remote was reachable and refused the run (`report === "refused"`, e.g. tree stayed different / gitignored file missing / env or disk refused).
- **Required fix:** Pass whether the failure came from a refusal vs unreachability (or use the lane's actual `why()` / refusal reason) so:
  - a refused run reports `remote ${target} refused (...); not run here (whenLost "not-run")` (never `"unreachable"` when the remote was reachable and refused),
  - a genuinely unreachable remote keeps `"unreachable"`.
- Add a focused unit/integration test in `test/runner-host/remote/` covering refused-tree vs unreachable wording under `whenLost: "not-run"`.

#### 4. O1 (`src/core/runner-host/remote/providers/agent37/index.ts`): Abort-safe `acquire`

- **Current observation:** A `SIGTERM` during daemon startup while `agent37` `acquire` is in flight did not cancel `POST /v1/instances` and logged `"Agent37 instance <id> created"` 0.8 s after `"daemon stopped"`, risking an untracked billed VM if the daemon exits mid-create.
- **Required fix:**
  - Respect `request.signal` across `acquire` (`api.inspect`, `api.create`, `untilRunning`, `bootstrap`):
    - If `request.signal?.aborted` before `api.create`, abort immediately without calling `POST /v1/instances`.
    - Pass `request.signal` to `api.create` / `untilRunning` / `bootstrap`, AND if `api.create` succeeds right as/after `request.signal?.aborted` becomes true, immediately delete the newly created instance (`await api.remove(made.id).catch(() => {})`) before throwing the abort error so no untracked Agent37 instance is ever left behind!
    - Also ensure `machine-share.ts` passes its shutdown/abort signal into `provider.acquire` (check how `request.signal` is currently wired in `machine-share.ts` and `daemon-lane.ts`).
- Add tests in `test/runner-host/remote/providers/agent37.test.ts` proving:
  1. pre-aborted signal makes 0 `POST /v1/instances` calls;
  2. signal aborted while `POST /v1/instances` is in flight deletes the created instance (`DELETE /v1/instances/<id>`) and leaves 0 instances in the mock API.

#### 5. Tighten `test/e2e/spec-026-remote.test.ts` and update `lessons.md`

- In `test/e2e/spec-026-remote.test.ts`:
  - Assert plain `squeal status` shows the `Remote:` line (provider, machine id, state, lanes, planning, environment mode) on healthy runs AND on refused slow-disk / other-arch runs.
  - Assert plain `squeal status` on refused slow-disk and refused other-arch under `whenLost: "not-run"` does **NOT** print `"the daemon listed no test files"` or `"Full-suite checkpoint: completed at revision 0"`.
  - Assert `squeal ps` while the remote runner host is alive shows provider, machine id, and `awake`.
- Update `docs/specifications/026-tiered-and-cloud-execution/lessons.md` to mark D1, D2, D3, and O1 resolved in `026-20` (and keep `O2` honestly documented as a harmless low-priority observation or note if untouched).

### Verification

- Do NOT run `pnpm run build` or a local full test suite.
- Run `pnpm run lint`, `pnpm run typecheck`, `pnpm run check:private`.
- Verify via Squeal (`squeal status --wait 60000 ...`) and explicit `pnpm exec vitest run` on:
  - `test/e2e/spec-026-remote.test.ts`
  - `test/runner-host/remote/providers/agent37.test.ts`
  - your changed `test/status/`, `test/ps/`, `test/runner-host/remote/`, and `test/store/worktree-meta.test.ts` (if `store.ts` changed)
  - `test/version-sensitive.test.ts`
- Never use `process.version` directly in tests, never commit absolute home paths.
