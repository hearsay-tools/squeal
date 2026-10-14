# 008 wave 1: the hooks and the wake, status, install, and the review of wave 0

Four rows in parallel, on disjoint files. Read `../spec.md` (as amended by wave 0) and `../status.md` first, then `../research/wave-0-checks.md`. Use the role line each row names. Test first. Real OpenCode runs as the agent user only through `runOpenCode` (`test/helpers/opencode.ts`); never against `~/.config/opencode`, `~/.local/share/opencode` or `~/.cache/opencode`. Spec 009's wave 1 (`../../009-pi-adapter/tasks/wave-1.md`) built the same rows for Pi; read its code before designing anything it already solved.

## 008-12 the OpenCode hooks and the idle wake

Use /worker. Outcome: an OpenCode agent gets deltas in tool results, is blocked once before an edit over an undelivered regression, carries the primer in every request, hears the end-of-turn news once, and is woken when idle with news.

- Spec: D3 (everything 008-10 did not build), D5, D9; goals 1 to 7 and 9. Research: `opencode-plugins.md` 3 to 5, `opencode-sessions-and-wake.md` 2 and 3, `wave-0-checks.md` 4.
- Shape: slice.
- Seam: `src/harness/opencode/plugin.ts` and `protocol.ts`, with new bridge request kinds over `src/harness/shared/` (deliver, peek and deny, prompt, stop, waiter). First edit: `tool.execute.after` appends `onToolBoundary`'s text to `output.output`, with a test that a second parallel call appends nothing.
- Owns: `src/harness/opencode/**`, `test/harness/opencode/**`, `test/harness/opencode-*.test.ts` (new real-OpenCode tests through `runOpenCode`). In `src/harness/shared/` only what D6 allows, with the Claude Code, Codex and Pi suites unchanged.
- Leaves alone: `src/cli/**` (008-13, 008-14), `install.sh`, `plugins/*/bin/**` (008-14), `test/helpers/opencode.ts` and `test/fixtures/opencode/**` (ask the coordinator if the helper needs a change). Do not commit `plugins/opencode/dist` or raise the version.
- Done when: unit tests on recorded inputs for each D3 hook; the deny never fires on `bash` by default and a bridge failure never throws; the `prt` id rule; the continuation once, never twice, and none after an abort; a child's consumer and its unregistering at idle; the waiter killed by a user message and by `dispose`. Real OpenCode under `run` and `serve` with the scripted provider: a delta in the next request, a block then a re-issued edit, one continuation then silence, the primer in a child session, `run` exits promptly, a wake under `serve`. Lint, typecheck and the full suite green.

## 008-13 status and pull credit under OpenCode

Use /worker. Outcome: `squeal status` run from an OpenCode agent's shell is credited to its consumer, and says when the plugin never ran.

- Spec: D2 (the `shell.env` variables), D7. Precedent: `src/cli/pi/status.ts`, `src/cli/codex/status.ts`, `src/cli/status-command.ts`.
- Shape: slice.
- Seam: `src/cli/status-wait.ts` where it reads `CLAUDE_CODE_SESSION_ID ?? CODEX_SESSION_ID`: add `OPENCODE_SESSION_ID` with `OPENCODE_AGENT_ID` for a child's consumer, with a test that a child's pull credits `(root, child)`.
- Owns: `src/cli/opencode/**` (new), `src/cli/status-command.ts`, `src/cli/status-wait.ts`, the lines of `src/cli/main.ts` that call status, `test/cli/opencode-*.test.ts`.
- Leaves alone: `src/harness/**` (008-12), `src/cli/update.ts`, `install.sh` and launchers (008-14).
- Done when: the `OpenCode:` line for both causes of D7 (a session id with no consumer, `OPENCODE=1` with no session id) and none otherwise; `squeal` named for an OpenCode shell as D7 says; a pull from a root and a child shell credits the right consumer; the Claude Code, Codex and Pi status tests unchanged; lint, typecheck and the full suite green.

## 008-14 install and update through OpenCode

Use /worker. Outcome: `install.sh` installs, updates and uninstalls Squeal in OpenCode through `opencode plugin` and a `current` link, and `squeal update` and the launcher cover it.

- Spec: D1 as amended; `wave-0-checks.md` 3. Precedent: 009-13 and 009-18 (`install.sh`'s Pi step, `--pi`, the install record, `src/cli/update.ts`, the launcher's package search).
- Shape: slice.
- Seam: `install.sh`'s Pi step; first edit: an OpenCode step that unpacks `plugins/opencode/` into `.../squeal/opencode/<version>/`, repoints `current`, and runs `opencode plugin file:<...>/current -g` only when OpenCode's global config does not list it yet.
- Owns: `install.sh`, `plugins/*/bin/squeal-launcher` (every copy stays identical), `src/cli/update.ts`, `test/cli/install-sh-opencode*.test.ts`, `test/cli/update-opencode.test.ts`, `test/cli/launcher.test.ts`, and `test/cli/install-fixture.ts` if needed.
- Leaves alone: `src/harness/**`, `src/cli/opencode/**`, `src/cli/status*.ts`, `plugins/*/dist`.
- Rules: tests stub `opencode` as 009's tests stub `pi`; a real `opencode plugin` runs only as `squeal-e2e` or through `runOpenCode`'s isolation. Never edit OpenCode's config from `install.sh`; never `--force`.
- Done when: install, a second install of the same version, an update that keeps the newest older directory and any a running process names, and `--uninstall` each tested; `squeal update` runs the OpenCode mode when OpenCode lists the `current` link; the launcher finds the newest OpenCode package; lint, typecheck and the full suite green.

## 008-15 review of wave 0

Use /reviewer. Outcome: `reviews/wave-0.md` committed, every finding labelled proven, plausible or unverified.

- Range: wave 0 as landed (the spawn names the commits). Spec: D1, D2, D4, D6, D8; `wave-0-checks.md`.
- Questions: can the plugin ever throw, hang OpenCode, or keep `opencode run` alive (D4's deadlines, the process-group kill, `dispose`); does the plugin bundle reach `node:sqlite` or `process.execPath`; is the fast path right outside and inside a Squeal repository and in a linked worktree (`worktree` against `project`); is the consumer identity of D2 right for a root, a child and a resume; does `runOpenCode` keep every run off the real `HOME`; is the bridge latency test honest at load.
- Writes only `docs/specifications/008-opencode-adapter/reviews/wave-0.md`. Runs real OpenCode only through `runOpenCode` or as `squeal-e2e`.
