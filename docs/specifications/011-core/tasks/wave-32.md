# Wave 32

From main after the tests-only w31 landing, beside the review of `cand/w31b` (011-179). R2 and W13 were added on the human's choices of 2026-10-24. One row on the host-load probes; it lands as docs, like 011-138 and 011-155 did. W12, added after W11 landed, is a survey on store copies; it lands as docs.

## W11: 011-177, `waste.mjs` counts a module the cancel cut in its grace as cut, not ended

Use /worker. Shape: repair (probe).

Outcome: the daily's `cancelled` table names, per cause, how many started files the cancel cut and their recorded seconds.

Read board row 011-177; `tasks/011-136/notes.md` sections 2 (F1), 6 and 8; `research/probes/host-load/README.md` ("How `waste.mjs` counts C3", "Files that never started").

Seam: `namedIn` in `research/probes/host-load/waste.mjs:20`. A lead: note the line `squeal: run cancelled` and give `ended` only the `MODULE` lines before it; then add `cut` and `cutSeconds` to each `cancelled` cause (named in the log, not in the report's `completedFiles`, no `MODULE` line before the note). `tasks/011-136/probes/cut.mjs`'s `parse` is the reference.

Owns `research/probes/host-load/waste.mjs`, the README's text on it, `tasks/011-177/`. Not yours: `src/`, `test/`, the other probes, `tasks/011-136/`, the board, spec text.

Done when, on a fresh pair of store copies (each with its `-wal` and `-shm`, then its run logs, under `nice -n 10 ionice -c3`; 011-136's copies are deleted), each project's `cut` equals `cut.mjs`'s started-and-cut count over the same window, `neverEnded` equals `cut` plus `neverStarted`, and C3's `keptShareStarted` is unchanged from today's script; the README names both new fields; the outputs and the load are in `tasks/011-177/notes.md`; commit. Read only on copies: never open a live store or socket, never run a script under `evals/bin/`, no `npm run build`.

## W12: 011-180 survey, what a tier's yield to an edit's work cuts and what it buys

Use /worker. Shape: survey.

Outcome: per project over 24 hours, the started files each yield cut, their low and high seconds, what the yield ran sooner and by how much, and one change that would keep more of them, or a reason not to change.

Read board row 011-180; `tasks/011-177/notes.md`; `tasks/011-136/notes.md` (a survey of the same shape: its sections 1 to 3 and its probes); `research/running-tier-yields.md` and `research/yields-replay.md` (rule B, 30 s, the human's choice in 001-381); 011 C4 step 5.

Seam: the `cancelled` cause `yield` in `research/probes/host-load/waste.mjs`; `tasks/011-136/probes/cut.mjs` with the cause changed; the decision in `src/core/scheduler/yields.ts:205`. The row's first question: did each yield meet rule B (an estimated remainder over 30 s, or an overrun), and how long did the work it yielded to then wait to start?

Owns `tasks/011-180/` (notes and any probe of your own). Not yours: `src/`, `test/`, `research/`, the other tasks' folders, the board, spec text.

Done when the row's done-when holds. The rule is the human's, so propose, never change. Copy each store with its `-wal` and `-shm`, then its run logs, under `nice -n 10 ionice -c3`; never open a live store or socket; never run a script under `evals/bin/`; no `npm run build`. Record the load beside each copy. Commit.

## R2: 011-181 research, who runs tests outside Squeal on this host and why

Use /researcher. Shape: research. The human started it on 2026-10-24.

Outcome: each direct test run outside Squeal on this host is named with its project, session role and class, so we know how much of the load is friction with Squeal.

Read board row 011-181; `research/host-load/011-139.md` (finding 3) and its probe `research/probes/host-load/011-139/`; `research/host-load/2026-10-24.md` (C1, C2, proposed rows); `research/probes/host-load/README.md`.

Two halves:
1. **Transcripts, the last 24 h.** Find every test command (Vitest, `npm test`, pytest, node:test) that agent sessions on this host ran: Claude Code under `~/.claude/projects/`, Codex under `~/.codex/sessions/`. Per run: project, session role (coordinator, worker, reviewer, researcher, eval subject, other), time, scope, and its class: (1) required by a repository's process, (2) not covered by Squeal, (3) Squeal had no current answer, (4) Squeal had an answer, friction, (5) load made on purpose. For class 4, quote what Squeal had said.
2. **Process sampling.** Start a read-only sampler of the process trees outside Squeal (CPU per tree, nice, owner project and session) for 24 h, from `/home/agent/projects/squeal/.ai/cezar/t/04a258b0/samples-011-181/`, with its script copied there and its cwd there, so it holds nothing of your worktree. Use `setsid`, `nice -n 10` and `timeout 24h`. Report what the first hours show, and write in the file how to join the rest.

Owns `research/host-load/011-181.md`, `research/probes/host-load/011-181/`. Not yours: `src/`, `test/`, the other research and probes, the board, spec text.

Rules: the repository is public. Quote at most a test command line, with any `NAME=value` removed; never copy other transcript text, an environment value or a credential. Read transcripts and `/proc` only. Never run an agent CLI, never write under `HOME`, never open a live store or socket, never run a script under `evals/bin/`. Done when the row's done-when holds for the transcript half and the sampled hours so far; commit.

## W13: 011-182, on a busy host a backlog tier takes permits only below half the slots

Use /worker. Shape: slice. The human chose "backlog only" on 2026-10-24.

Outcome: on a host busy with other work, a backlog tier grows only while the grants are below half the slots; a checkpoint tier, an edit's tier, and a host where Squeal is the load are unchanged.

Read board row 011-182; 011 C10 Size as amended 2026-10-24; `research/host-load/011-139.md` findings 3 and 5 and recommendation 2.

Seam: `gatedPermits` (`src/core/capacity/cores.ts`) and `#gated` (`src/core/capacity/pool.ts:398`). The pool does not know a tier's kind today: it reaches the pool through `src/core/scheduler/capacity.ts:57` and `:102` and `tiers.ts:240`. First edit: give `gatedPermits` the host's busy cores, or `null`, and start its CPU sum at the larger of that and the marks' CPU. Read the busy cores beside `TreeCpu` over the same window, `%nice` included. Pass them only for a backlog acquisition or offer.

Owns `src/core/capacity/`, `src/core/scheduler/capacity.ts`, the kind where `tiers.ts` passes it, their tests, `tasks/011-182/`. Not yours: `test/keys/validity/` (011-179, in review), `research/`, the board, spec text (propose wording in your notes), bundles, version. If the key-format alarm asks for a raise, stop and send me a request. No `npm run build`.

Done when the row's done-when holds; lint, typecheck and `squeal run --all --wait` pass (bundle drift excepted). Run every test command with `env -u PLUGIN_ROOT -u PLUGIN_DATA`. Paste the output.
