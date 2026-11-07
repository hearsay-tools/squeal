# Wave 72: rows 011-308 (a named wait's batch does not wait for the CPU pool) and 011-309 (the wait says when it waits for CPU)

Coordinator 83be4a7a, 2026-11-07. The human approved `011-308/design.md` as drafted (D1, D2, no new width guard) and one worker for both rows. Version 0.1.413. Users see this change.

Host policy, as in `wave-60.md`: no local full suite, no `squeal run --all`; `env -u PLUGIN_ROOT -u PLUGIN_DATA` on every test command; private `/tmp` fixtures; never make CPU load on purpose; no `pnpm run build`; no real harness session under the real HOME. Not yours: the board, `spec.md`, `status.md`, `plugins/*/dist`, the `package.json` version. Read affected results with `squeal status --wait 60000 <paths>`.

## W1: rows 011-308 then 011-309

Use /worker. Shape: slice, test first, one commit per row (011-308 first).

Outcome: on a busy host a named wait's batch starts at once at an edit tier's size and width, and a file still held by the pool says so.

Read: the board rows 011-308 and 011-309; `tasks/011-308/design.md`; spec 011 C10 Capacity (the two bullets dated 2026-11-07) and C15 "A batch on a busy host"; `research/wait-timeouts.md` Q2 (the "promoted" row) and the recommendation.

Seam and lead, 011-308: `selectTier` in `src/core/scheduler/tiers.ts`, the `taken === WAIT_FOR_CAPACITY` branch and the "granted less than offered" trim. First edit: a scheduler test with a pool that refuses every permit, where a named wait on 6 queued test files starts a 4-file tier at once, then the other 2. Then: when `batch !== null` and the pool refuses or grants under an edit tier's width, re-pick at most `runner.tierSize` batch files and start them without a lease, with `running(workers)` as an edit's tier does (`TierCapacity.running`). Keep `promoted: true` and `batchStarted`. A granting pool keeps today's one wide tier; prove that too. Update the doc comments of `selectTier` and `batchFiles` (`promoted-tier.ts`).

Seam and lead, 011-309: `TierCapacity` (`src/core/scheduler/capacity.ts`) knows a refusal; the pool (`src/core/capacity/pool.ts`, `cores.ts`) knows busy cores, slots and grants. Publish them beside the promotions/standing the status reads (`scheduler/promotions-row.ts`, `types/standing.ts`), render in `status/next-step.ts` (`queuedStep`) and the deadline line (`cli/no-verdict-lines.ts`), and add the fields to `--json`. Line text: the design's D2, verbatim except for numbers. Log through the daemon's existing log, once at a wait's start, once at its grant with seconds. An older daemon's published row without the fields reads as today; test it.

Owns: `src/core/scheduler/**`, `src/core/capacity/**`, `src/core/status/**`, `src/core/types/standing.ts`, `src/cli/no-verdict-lines.ts`, `src/cli/status-wait*.ts`, and their tests. Ask first before touching other files.

Done when: the rows' done-when holds; lint and typecheck pass; affected results read through `squeal status --wait`; notes in `tasks/011-308/notes.md` list any deviation from the design and the spec sentences to amend (the coordinator edits the spec).
