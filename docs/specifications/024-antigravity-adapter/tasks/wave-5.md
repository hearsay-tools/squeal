# Wave 5: non-blocking polish before release

Spec: `docs/specifications/024-antigravity-adapter/spec.md` (with `status.md`, `reviews/0.1.605.md`, and `lessons.md`).
Approved by the human on 2026-11-23 ("Do 024-09 polish first" before cutting the hub release).

## Row 024-09: polish (`latency.test.ts` silence predicate, Antigravity post-update launcher wording, `install.sh --uninstall` marketplace line)

- **Role**: `/worker` (slice).
- **Files owned**:
  - `test/harness/antigravity/latency.test.ts`
  - `plugins/claude-code/bin/squeal-launcher`
  - `install.sh`
  - `test/cli/launcher-antigravity.test.ts`
  - `test/cli/install-antigravity-uninstall.test.ts`
  - `test/cli/install-sh-uninstall.test.ts`
- **Do not edit**: `docs/board.md`, `package.json`, `plugins/*/dist/`, `plugins/*/bin/` copies other than the single source `plugins/claude-code/bin/squeal-launcher` (the coordinator runs `pnpm run build` at integration). Do not touch `plugins/codex/` or `plugins/codex/seed/`.
- **Requirements**:
  1. **`test/harness/antigravity/latency.test.ts` (review `0.1.605.md` S1)**:
     - Replace the fragile `c.name.endsWith("(silent)")` predicate on line 166 with an explicit `readonly silent?: boolean` property on `Case`.
     - Set `silent: true` on all three silent cases: `"pre-invocation (after tools, silent)"`, `"pre-tool-use (run_command, silent)"`, and `"stop (silent)"`.
     - Update the JSDoc comment on `Case` and assert `if (c.silent) expect(out.stdout, c.name).toBe("")`.
  2. **`plugins/claude-code/bin/squeal-launcher` (`lessons.md` defect 1)**:
     - Keep `# squeal-launcher format 9` (the `older` notice branch only executes from `<PLUGIN_DATA>/bin/squeal`, which `keepVersion` refreshes by byte comparison on new versions; `~/.local/bin/squeal` never has a sibling `versions/` directory and `install.sh` refreshes it by `cmp -s`).
     - In the `older` branch (around line 229-231), keep the Codex data-directory wording unchanged:
       `inCodexData`: `; Codex sessions started on ${kept.version} keep ${kept.version} until they restart`
     - Change the non-Codex (`!inCodexData`, Antigravity) wording to accurately state what happens:
       `; open Antigravity sessions move to ${run.version} at their next hook, and the running ${kept.version} daemon hands over then`
     - Update the nearby comment (lines 218-220) to match.
     - Update `test/cli/launcher-antigravity.test.ts` to assert the exact new message (keep notice deduplication per `ANTIGRAVITY_CONVERSATION_ID` and `launcher-notices.json` assertions).
  3. **`install.sh` (`lessons.md` defect 2)**:
     - In `uninstall()`, before calling `uninstall_in claude` / `uninstall_in codex` (which may `forget` ownership records), detect whether Claude Code (`has claude || owns claude || [ -n "$(installed claude)" ]`) and/or Codex (`has codex || owns codex || [ -n "$(installed codex)" ]`) are relevant on this machine.
     - Replace the unconditional marketplace line at the end of `uninstall()` with conditional output:
       - Both Claude Code and Codex: `The hearsay marketplace stays added; claude plugin marketplace remove hearsay and codex plugin marketplace remove hearsay remove it.`
       - Claude Code only: `The hearsay marketplace stays added; claude plugin marketplace remove hearsay removes it.`
       - Codex only: `The hearsay marketplace stays added; codex plugin marketplace remove hearsay removes it.`
       - Neither (e.g. Antigravity-only, Pi-only, OpenCode-only): print no marketplace line.
     - Update `test/cli/install-antigravity-uninstall.test.ts` to verify an Antigravity-only uninstall prints no marketplace line.
     - Update `test/cli/install-sh-uninstall.test.ts` to cover Claude-only (prints only `claude plugin marketplace remove hearsay`, not `codex`), Codex-only (prints only `codex plugin marketplace remove hearsay`, not `claude`), and both (prints both).
- **Done when**:
  - Targeted tests pass: `pnpm exec vitest run test/harness/antigravity/latency.test.ts test/cli/launcher-antigravity.test.ts test/cli/launcher.test.ts test/cli/launcher-codex-runtime.test.ts test/cli/install-antigravity-uninstall.test.ts test/cli/install-sh-uninstall.test.ts test/cli/install-sh-pi.test.ts test/cli/install-sh-opencode.test.ts test/harness/launcher-copy.test.ts`.
  - `pnpm run lint`, `pnpm run typecheck`, and `pnpm run check:private origin/main HEAD` pass.
  - Do not run `pnpm run build` or a full test suite.
