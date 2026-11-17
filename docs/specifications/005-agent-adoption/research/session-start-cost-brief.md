# Research brief: where the session-start hook's time goes

Row 005-101, asked by the human 2026-11-17. Coordinator: session 4d2ecbfc. Use /researcher. Findings file: `session-start-cost.md` beside this brief. No product code changes.

## The observation

Under Squawk a resumed session's SessionStart hook often ends "cancelled", exit 1, with its whole registration text in the output (the human's example, in cezar: revision 0, 21,973 current, 992 test files unknown, groups `run-loop` and `browser`). So the hook finished its text and still passed the 2 s limit of `plugins/claude-code/hooks/hooks.json`; the session never reads that text. `daemon-restart-per-turn.md` (row 005-99) measured what follows; it did not time the hook itself.

## Questions, in the human's words

"Doesn't it point at a suboptimal performance of all of this? Do we have proper indexes in the store? Can it be read faster? Can there be a view or something like this for faster startups? Do we need to retain less? What's the root cause?"

1. Root cause: a time budget of one SessionStart hook, start to exit, by step: Node start and bundle load, store open (and any check or migration at open), each store read with its row count and its query plan (`known_states`, `test_file_keys`, checkpoints, revisions, meta), the header and the failure blocks, formatting, the registration write and its wait for the store's write lock, the daemon start and the heartbeat wait, output, exit (what keeps the process alive after the output). Median and p90, in cezar's and this repository's real stores (read-only copies), at the host's real load, stated per run; the same with the store's write lock held by a starting daemon (005-99: 3.6 s per start in cezar).
2. Indexes: for each read in 1, `EXPLAIN QUERY PLAN`; name each scan that an index would turn into a search, with the measured gain on a copy.
3. Read less: which of these reads the registration text of 0.1.537 and later still needs (it dropped the worktree counts, inherited and imported counts); what a maintained summary row (or a view) written by the daemon would save; what it would cost on the write side.
4. Retain less: table sizes and row counts of both stores, by table; which rows no read needs (old runs, states of files no longer listed, other worktrees' rows); what the hook's reads cost as a function of them.
5. "Lookup-only" at session start: what the hook costs when it only reads and registers and starts no daemon (the daemon starting at the first tool boundary), measured the same way.
6. The same budget for the candidate `origin/cand/0.1.541` (register first), if it is still there, or main after it lands.

## Sources and limits

`src/harness/shared/{session,ensure,deliver}.ts`, `src/core/state/header.ts`, `src/core/delivery/delivery.ts` (`registerNow`), `src/core/store/**` (schema, indexes, open), earlier findings `../../011-core/research/fresh-start-counts.md` (row 011-223) and row 011-226. Squawk run logs show each cancelled hook with its times. Work on copies of the stores in your scratch directory; never write to a live store; never run `evals/bin` scripts; never run a script to check it; make no load on purpose. Write `~`, never a `/home/<user>/` path.

## Deliver

The budget table; the root cause in one paragraph; candidate rows ranked by measured gain per cost, each with its owner (hook: 005; store and daemon: 011) and what it changes for users outside Squawk; what stays unknown.
