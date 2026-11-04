# 019-25 notes: a named status --wait for a group file waits only for what the group's moment allows

Worker 68f6aed7, 2026-11-04, after 019-24 on the same branch. The coordinator split it out of 019-24 item 2 (reply to request 6d6a1b2a, option C). This row owns `src/core/status/standing.ts`, `next-step.ts` and `src/cli/named-step.ts`. Commits `76c0d9b14` (4) and `60ed6a496` (3).

## What changed

- **(4) What a named wait holds for.** `pauseOnlyIds` (`standing.ts`) leaves a queued file out by the moment of the group that owns it (`outsideTurn`): a group lane not at `edit`. It no longer requires `slow.trigger: "idle"`. The default `slow` group is at `edit` exactly under `"continuous"` (D2, `defaultGroups`), so without `checks` the rule is 004-80's. With `checks`, a pause, stop or commit group's queued file is left out under every trigger: the wait gives the other files' verdict and names the group's file with 019-24's clause. An `edit` group's file is now held for under `"idle"` too: it runs in the turn.
- **(3) The words for a group's queued file.** The `slow` `PendingReason` has an additive `group?: { name, at }`, set by `queuedReason` for a configured group's file. The default `slow` group's file keeps today's reason. `nextStep` words it in `groupStep`: reason `in the e2e group, run when the agent pauses or on {command}` (`at each commit`, `after each edit` by moment). The step is `run e2e`. The verdict line's short form keeps the moment except at `edit` (`in the e2e group`), as a slow file's keeps "when the agent pauses" only under `"idle"`. `namedStep` does not rewrite it to "behind the fast backlog". A group's file gets no `slot` (the default slow slot's holders): its slot is its group's (`slotOf`). The slow case of `nextStep` moved to `slowStep`; no function's complexity rose.

## Decisions

1. `group` carries the moment as well as the name, so `nextStep` stays pure. The coordinator's request said `group?: string`; the object is still additive.
2. Stop and pause share `when the agent pauses`, as the group's status line says (019-16 `groupWhenText`).

## Found, not fixed

- `squeal retry` of a configured group's file (`src/core/retry/waits.ts`, `src/cli/retry-queue.ts`) still reads the slow group's `isSlow` (019-16 notes).
- `outstanding.ts` reads only the slow tier's activity for a pending file's reason.

## Tests

- `test/cli/status-wait-group-moment.test.ts`: under `"continuous"`, a stop, pause and commit group's file is left out. The wait settles under 2 s with the other file's verdict, exit 0, and the clause by group. Under `"idle"`, an edit group's file is held until it has its result. The class line for a stop and a commit group, with `squeal` and the Codex path, never `run --slow`. An edit group's timeout reason, `1 in the e2e group: `squeal run e2e``.
- Unchanged, current: `status-wait-paths-slow` (004-78), `named-wait-reasons`, `next-step*`, `status-wait-reasons`, `outstanding`, `slot-holders`, `why-unknown-standing`, `evals/named-wait`.
