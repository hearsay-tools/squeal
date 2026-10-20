# 012 Claude Code adapter: status

Stage: shipped (inherited from 001, shipped 2026-10-06)
Started: 2026-10-17, forked from `../001-core-loop/spec.md` at `cdd72a91` by the split proposal (`../001-core-loop/split-proposal.md`, section 6)

## Decisions so far

- 001's decisions through 0.1.203 stand; they are in `../001-core-loop/status.md` (frozen) with the amendment lines that made them. The crosswalk at the end of `spec.md` maps every 001 section to its section here.
- The split proposal's decisions by the human (Q1 to Q8, 2026-10-16 and 2026-10-17) bind this spec: see its sections 9 and 11.

## Amendment log

Every accepted deviation is a dated line here and an edit to the section of `spec.md` it changes (`docs/process.md`, step 6).

- 2026-10-17: forked from 001 at `cdd72a91`. 001's text lifted verbatim (tagged paragraphs); the notes and the sections 001 did not have are new and change no rule.
- 2026-10-20 (task 012-01, the human: "we need a row and fix it"): CC1 adds the rule that every hook entry's `command`, run without its `args` and with a payload on stdin, runs nothing and exits 0. Cursor CLI 2026.10 imports the plugin and drops `args`, so PreToolUse ran the payload as a shell script (`research/cursor-dropped-args.md`). Turning the plugin off through `enabledPlugins` was declined, since it turns Squeal off in Claude Code too.
- 2026-10-20 (task 012-01, coordinator repair of `reviews/012-01.md` B1): the CC1 rule of the same day gains one exception. When the plugin root contains whitespace, a harness that runs `command` through a shell gets exit 127 and a "not found" line instead of a silent 0, and still nothing runs or is read. No single `command` fixes both harnesses: Claude Code takes it as an exec path, so quotes would be part of it. `test/harness/dropped-args.test.ts` pins the exception. The coordinator accepted this, since the harms the row fixes (a block, a payload run as code) do not occur.
