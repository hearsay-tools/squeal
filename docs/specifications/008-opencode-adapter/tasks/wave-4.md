# 008 wave 4: after shipping

## 008-39 quality pass over spec 008

Use /quality. Shape: survey.

Read `docs/vision.md`, `docs/styleguide.md`, `../spec.md`, `../status.md` and `../lessons.md`'s Defects sections.

**Stretch:** `abe708ca` (008-10, the bridge client) to `163882d7` (0.1.192), limited to `src/harness/opencode/`, `src/cli/opencode/`, the OpenCode parts of `install.sh` and `src/cli/update.ts`, `test/harness/opencode*`, `test/e2e/opencode*` and `test/helpers/opencode.ts`. There is no earlier file under `../quality/`; 009's `../../009-pi-adapter/quality/2026-10.md` covers Pi's sibling code.

**Leads, offered, not required:**
- `turns.ts` grew by repairs (008-16, 008-25, 008-28, 008-31, 008-33): state flags (`open`, `continued`, `aborted`, `epoch`, `held`, `own`) that could be one turn state.
- Code shared in shape with Pi's adapter (`src/harness/pi/`) or the core's end of turn, which 009-27 and 009-28 already name for Pi.
- The e2e diagnostics (`opencode-timeline.ts`, `opencode-watch.ts`, `held-stop.ts`): test code past about 300 lines that only explains failures.

Writes only `docs/specifications/008-opencode-adapter/quality/2026-10.md`. Never edits the board, never gates a merge. No full suite.
