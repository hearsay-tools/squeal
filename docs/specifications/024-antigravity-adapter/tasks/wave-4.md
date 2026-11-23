# Spec 024 Wave 4: live Antigravity CLI proof and dogfooding (row 024-08)

Read first: `docs/process.md`, `docs/vision.md`, `docs/styleguide.md`, `docs/specifications/024-antigravity-adapter/spec.md`, `docs/specifications/024-antigravity-adapter/status.md`, `docs/specifications/024-antigravity-adapter/research/antigravity-hooks-and-plugins.md`, `docs/specifications/024-antigravity-adapter/research/wave-0-checks.md` (and its isolation script in `research/probes/wave-0-checks/`), `docs/specifications/024-antigravity-adapter/reviews/0.1.605.md`, and `docs/specifications/009-pi-adapter/lessons.md` (for report format).

## Row 024-08: Live CLI proof and dogfooding

### Role and shape
- Shape: proof and dogfooding. You are the judge; the Antigravity CLI sessions you start are the users.
- **Fix nothing in `src/` or `plugins/`.** Record every defect or surprise honestly in `lessons.md` with its reproduction, severity (blocker vs non-blocking), and proposed row.
- File ownership: `docs/specifications/024-antigravity-adapter/lessons.md` only (keep throwaway scratch repos, temporary `HOME` dirs, and raw transcripts in `$TMPDIR` or `/tmp` and clean them up at the end; do NOT commit raw session logs, credentials, or any absolute home paths).

### Standing model rules (mandatory)
- Claude models run ONLY in Claude Code and Cursor (human rule, 2026-10-14). Every Antigravity CLI session you launch MUST use a Gemini model, NEVER a Claude model:
  - **`gemini-3.8-flash`** (fast tier, e.g., `--model gemini-3.8-flash`): use for sessions where only hook/daemon mechanics are verified (install/update retention, `PreToolUse` deny mechanics, `Stop`/`stop-slow`, subagent consumer registration, `HarnessProcess` cleanup, `squeal status` unregistered diagnostic, `stream-json` hook env).
  - **`gemini-4-argon`** (or **`gemini-4-neon`**): use for the dogfooding session(s) where the model's own reading of Squeal's primer, `PASS -> FAIL` reports, edit-deny reasons, and leaving Vitest to Squeal is the question itself.

### Isolation and safety (mandatory)
- Find the host's Antigravity CLI via `ls "$HOME/.local/share/hearsay-squawk/tools/antigravity/linux_amd64/versions/"*/antigravity | head -n 1` (never hardcode any home path in committed files).
- Run EVERY live Antigravity CLI session in a fresh temporary `HOME` under `/tmp` (e.g., `/tmp/squeal-dogfood-024-home/`). Follow `research/wave-0-checks.md` ("Live runs used a temporary `HOME`. In it, only the CLI's OAuth token file was symlinked; the token was never read or printed"): inspect `research/probes/wave-0-checks/q2-installed-plugin.sh` to see the exact symlink setup.
- Verify the real `~/.gemini/config/` (if present) is untouched before and after (`sha256sum`).
- Never read, echo, log, or commit any OAuth token or API key.
- Never leave any fixture daemon or Antigravity process running after finishing (`squeal stop` in every scratch repo + verify no processes remain pointing at `/tmp/squeal-dogfood-024-*`).

### What to prove (Spec 024 Goals 1–8 and open non-blocking notes)

Install the committed `0.1.605` plugin into your isolated `HOME` the way a real user does: pack a local source archive of `HEAD` (`git archive --prefix=squeal-0.1.605/ -o "$ARCHIVE_DIR/squeal--v0.1.605.tar.gz" HEAD`) and run `install.sh --antigravity` with `SQUEAL_SOURCE="file://$ARCHIVE_DIR"` and `SQUEAL_ANTIGRAVITY_BIN=<cli>` (verifying `plugin install`, ownership record, and `$PLUGIN_DATA` creation). Also verify `squeal status` in an Antigravity shell BEFORE installing the plugin (or with `plugin disable squeal`) to prove Goal 8's diagnostic line live.

Run live sessions against BOTH:
- **Part A: Scratch TypeScript + Vitest fixture repository** (small, fast, deterministic; with a slow test file for `Stop`/`stop-slow` and `interrupt.onRegression: true`):
  1. **Goal 1 & 2 (`-p`, `gemini-3.8-flash` or `gemini-4-argon`)**: `SessionStart` spawns the daemon from `$PLUGIN_DATA/versions/0.1.605/dist/cli/squeal.mjs` and injects the primer; the agent edits a source file to break a test, sees `PASS -> FAIL` mid-turn via `PreInvocation` without running Vitest itself, fixes the break, and sees `FAIL -> PASS` via `PreInvocation` (no noise on `PASS -> PASS` or unchanged failures).
  2. **Goal 3 (`-p`, `gemini-4-argon`)**: With `interrupt.onRegression: true`, an undelivered regression causes `PreToolUse` to deny the next file edit once with the regression entries; verify the model reads the deny reason and retries/adjusts its edit in the same turn without blocking forever.
  3. **Goal 4 (`-p`, `gemini-3.8-flash`)**: Sequential `Stop` + `stop-slow` with a slow test (`stop.requireSlowSuite: true`): verify silent `stop` hands off to `stop-slow`, which holds and continues the turn with `{"decision": "continue", "reason": ...}`, and the continued turn stops cleanly (`executionNum: 1`) without looping.
  4. **Goal 5 (`-p`, `gemini-3.8-flash`)**: Subagent (`invoke_subagent`) runs as its own consumer `(conversationId, "main")`, receives its own registration/primer, and does not corrupt the parent's view; also check `fullyIdle: false` on parent `Stop` while the subagent is running (if observable) stays silent and does not hold.
  5. **Goal 6 (`-p`)**: After `antigravity -p` exits, confirm its `HarnessProcess` is gone and `dropGoneHarnesses` unregisters its main (and subagent) consumer(s) from the Squeal store automatically without any `SessionEnd` hook, while the detached Squeal daemon remains alive past CLI exit (then cleanly stop it afterwards).
  6. **Multi-turn `--input-format stream-json --output-format stream-json` (`gemini-3.8-flash`)**: Run a 2-turn `stream-json` session (matching Squawk's Antigravity runner mode), proving:
     - Turn 1 registers and delivers `PASS -> FAIL`.
     - Turn 2 resets `invocationNum` to `0`, delivers or stays silent accurately, and confirms what `ANTIGRAVITY_*` / `PLUGIN_*` env vars appear in hooks and `run_command` shells under `stream-json` (closing the open non-blocking note in `status.md`).
  7. **Goal 8 (`install.sh --antigravity` update + `$PLUGIN_DATA` retention)**: While a daemon from `0.1.605` is running in the scratch repo, install a synthetic `0.1.606` archive over it via `install.sh --antigravity` (in the isolated `HOME`), prove the running `0.1.605` daemon survives and still validates edits, and prove `$PLUGIN_DATA/bin/squeal status` works across the in-place update. Also verify `install.sh --uninstall` cleans up owned plugin and unused `$PLUGIN_DATA`.

- **Part B: Dogfooding on a detached copy of this repository (or a real Vitest repo)** (`gemini-4-argon` or `gemini-4-neon`):
  - Use a temporary clone/worktree of this repository (or a real multi-file Vitest project in `/tmp`) with `0.1.605` installed in the isolated `HOME`.
  - Give the model a real small coding task (e.g. intentionally introducing a subtle bug in one module and asking it to implement a small behavior change, or editing a pure utility module and fixing the resulting failure without running `vitest` directly).
  - Observe and record honestly:
    - Did the model read the `SessionStart` primer and leave Vitest to Squeal?
    - Did `PASS -> FAIL` arrive mid-turn in `PreInvocation` and change what the model did?
    - Did the model treat SQUEAL messages as Squeal's test reports (not as new user instructions)?
    - Did any hook time out, fail closed, or misbehave? What was host load average during each session?

### Output (`docs/specifications/024-antigravity-adapter/lessons.md`)
Write a clear, concise, evidence-backed `lessons.md` covering:
1. **Verdict**: Does each of Goals 1–8 hold live? Is there any blocker preventing moving Spec 024 to `shipped`?
2. **Goal-by-goal table**: Goal 1–8 + `stream-json` env note, Holds? (Yes / Partial / No), Session & Model, Evidence.
3. **Setup & sessions table**: CLI version, Squeal commit (`0.1.605`), isolation, models, host load at each session.
4. **Key observed transcripts / timelines** (sanitized snippets only, no raw logs, no home paths, no tokens).
5. **Defects & observations**: every issue or surprise found, tagged blocker vs non-blocking, with reproduction and proposed follow-up row if any.

### Verification before finishing
- Run `pnpm run check:private origin/main HEAD` and verify 0 problems (zero home paths, zero session logs).
- Verify no leftover scratch daemons or Antigravity processes remain running, and temporary `/tmp/squeal-dogfood-024-*` directories are cleaned up.
- Verify real `~/.gemini/config/` (if it existed) has the exact same `sha256sum` as before you started.
- Commit `docs/specifications/024-antigravity-adapter/lessons.md` on your branch.
