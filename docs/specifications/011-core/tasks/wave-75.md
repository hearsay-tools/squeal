# Wave 75: fixes from the daemon idle CPU research (rows 011-314, 011-315, 011-317)

Coordinator 4f261dae, 2026-11-12. The human approved rows A, B, C and D of `research/daemon-idle-cpu.md`. Row 011-316 (C, docs) is done by the coordinator. W1, W2 and W3 own disjoint files and run in parallel; one candidate, one review.

Host policy, as in `wave-73.md`: no local full suite, no `squeal run --all`, no `pnpm run build`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no real harness session under the real HOME. Never signal, attach to or stop a daemon you did not start. Not yours: the board, `status.md`, `plugins/*/dist`, the `package.json` version.

## W1: row 011-314, a linear runner-host line reader

Use /worker. Shape: slice, test first.

Outcome: a long protocol line costs the daemon time linear in its length.

Read: board row 011-314; `research/daemon-idle-cpu.md` section 1; `src/core/runner-host/protocol.ts` (`LineReader`) and its caller `src/core/runner-host/connection.ts`.

Seam and lead: `LineReader.push`. First edit: a test that feeds a 16 MB line in 4 KB chunks and expects one message, within a time bound that fails today. Then keep the unfinished line's chunks in a list and search only the new chunk for `\n`. Keep the frame rule (`frameOf`) and the throw on a line that does not parse. Sending coverage `code` and `map` by file is out of scope: note it in `tasks/011-314/notes.md` if you see a reason.

Owns: `src/core/runner-host/protocol.ts`, its tests, `research/probes/daemon-idle-cpu/line-reader-bench.ts`.

Done when: the bench parses a 32 MB line in 64 KB chunks and a 4 MB line in 4 KB chunks in under 0.5 s each (state the host load); the new test passes; lint and typecheck pass; affected results read through `squeal status --wait 60000 <paths>`.

## W2: row 011-315, the code-store prune without a full key read

Use /worker. Shape: slice.

Outcome: the hourly code-store prune no longer reads every result key of the main store.

Read: board row 011-315; `research/daemon-idle-cpu.md` section 2 and `probes/daemon-idle-cpu/prune-probe.ts`; spec 011 C7; spec 015 D4 and D8; `src/core/code/store/prune-main.ts`, the code store's `prune`, `src/core/store/repos/results.ts`.

Seam and lead: `pruneCodeStoreAfter` calls `main.results.keysSince(0)` and passes every key. Lead: ask the main store only about the keys the code store holds (a bounded `IN` query, or an attached read), or another approach you measure as faster; keep the rule that a coverage record stays while its key has a result.

Owns: `src/core/code/store/prune-main.ts`, the code store's prune, a new `ResultRepo` method if needed (`src/core/store/repos/results.ts`, `src/core/types/store.ts`), their tests. No store format change: ask first.

Done when: on a copy of cezar's store (`/home/agent/projects/cezar/.git/squeal/`, copied to your scratch directory, deleted afterwards) the code-store prune takes under 5 s, from 35 s; a test proves a record whose key has a result is kept and one whose key has none is removed; lint and typecheck pass; affected results read.

## W3: row 011-317, `squeal ps` never advises killing a job supervisor

Use /worker. Shape: slice, test first.

Outcome: `squeal ps` does not list a process that only carries a daemon command line in its arguments (an `hsq job` supervisor) as a daemon, and never prints a kill that ends a live daemon.

Read: board row 011-317; `research/daemon-idle-cpu.md`, open questions; spec 014 D2 and D7; `src/core/ps/discover.ts`, `processes.ts`, `flags.ts`.

Seam and lead: where `ps` decides a process is a daemon from its arguments. First edit: a test with a supervisor whose command line is `node …/squawk/dist/index.js job start … -- node …/squeal.mjs daemon <root>`, parent of the real daemon, expecting no daemon row and no flag for it.

Owns: `src/core/ps/`, its tests.

Done when: the new test passes; the real daemon below it is still listed; lint and typecheck pass; affected results read.

## R1: review of cand/0.1.446

Use /reviewer (codex gpt-6.1-sol high, worker 8afc55fe). Pinned to `cand/0.1.446` at `e835adbd8abb14a1ca1aa0e6306a1a8d84f7b603`; range `6eb3c3a0a..e835adbd8`. Checks: the line reader's messages for every chunking and after a throw; the code-store prune never removes a record whose key has a result, chunked lookups at 0, 1, 1,000 and 1,001 keys, the dead-worktree walk; `ps` finds every daemon launch shape and no supervisor. Verdict: PASS (`reviews/0.1.446.md`), S1 a pre-existing retention race, row 011-318.
