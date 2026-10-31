# Wave 64: row 011-288 (a notice is told only after its hook handed the text to the host)

Coordinator c1325b17, 2026-10-31. The human chose "A: Yes, all four tools" on 2026-10-31 (board row 011-288). Version 0.1.386 claimed. Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, bundles, version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: row 011-288

Use /worker. Shape: slice, design first.

Outcome: in Claude Code, Codex, Pi and OpenCode, a report's delivery is committed (the consumer view advanced) only after Squeal's hook has handed the whole text to the host within its deadline; a hook stopped before that leaves the report owed, and the next eligible boundary delivers it. A rare duplicate (handed over, then stopped before the commit) is accepted.

Read: `research/delivery-receipt.md` (all), `research/ci-opencode-continued.md` sections 2 and 3, and their probes; spec 011 C8; specs 002 D3 and D4, 008 D3 to D5, 009 D3 to D5, 012 CC2.

The rule, fixed: "handed to the host" means, per path, the last step Squeal itself controls: Claude Code and Codex, the hook's stdout (or the waiter's stderr) written and drained before exit; Pi, the host side received the worker's answer before its deadline; OpenCode, the plugin received the bridge's answer before its deadline. Squeal does not claim model receipt. Every delivery path that advances the view counts: tool boundary, turn start, Stop, idle wait, regression `peek`.

Seam and lead: `src/core/delivery/delivery.ts:260`, where the view is written inside the transaction before the delta returns; split it into a prepared report and an explicit commit the harness calls after the hand-off. The OpenCode and Pi hosts then need a second message (commit) to their bridge or worker; Claude Code and Codex commit in-process after the write.

First: write `tasks/011-288/design.md` (at most one page: the prepare/commit split, each adapter's commit point, what a duplicate looks like, the other "told" effects the research names and which of them move, concurrency between two boundaries), commit it, and send the coordinator a request with its path. Wait for the reply before code.

Owns: `src/core/delivery/**`, `src/harness/{shared,claude-code,codex,pi,opencode}/**` as the design needs, new or extended tests, `tasks/011-288/`. Leave alone: `src/core/scheduler/**`, `src/cli/**`.

Done when, red before and green after: for each of the four adapters, a test that holds the hook after the report is prepared and before the hand-off, lets the deadline expire, then reaches the next boundary: the transition arrives once, and the boundary after it does not repeat it; a normal delivery still commits once; the research's probes, reversed, pass. Existing delivery and adapter tests pass; lint and typecheck pass.

Stop and report if the rule needs a store schema change or a key change, or changes what a normal (not stopped) delivery prints.
