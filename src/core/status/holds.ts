import { harnessGone, pidNamespace } from "../delivery/harness-process.js";
import { readCommandHolds, readMergeHold } from "../scheduler/hold-rows.js";
import { plural, timeText } from "../text.js";
import type {
  DaemonLiveness,
  EpochMs,
  HarnessProcess,
  HoldChange,
  HoldEnded,
  StatusHold,
  Store,
  WorktreeRecord,
} from "../types/index.js";
import { liveStartedAt } from "./open-runs.js";

/*
 * Row 011-73 (spec 011 C6, C9 and C15 as amended 2026-10-21;
 * `tasks/011-61/design.md` section 2, R2): the holds on a worktree's
 * validation as status, the hooks and the waits name them. The merge hold's
 * row is trusted only from the live daemon, written since its start, as the
 * promotions' row is (C15); the command holds' row is a request, read as
 * written, and each holder's processes are judged as a harness process is (C8).
 */

/** The unmerged paths a line names before `and N more`. */
export const HOLD_PATHS_SHOWN = 3;

type MergeHold = Extract<StatusHold, { cause: "merge" }>;
type CommandHold = Extract<StatusHold, { cause: "command" }>;

/**
 * A hold and what keeps it the same hold from one read to the next (review
 * 0.1.269, B2): `merge`, or `command:` and the command hold's token, so two
 * holds that run the same command stay two.
 */
export interface KeyedHold {
  readonly id: string;
  readonly hold: StatusHold;
}

/**
 * The holds on `worktree`'s validation: the merge hold its live daemon
 * published, then each command hold by start. `daemon` is the liveness the
 * caller judged at `now`; `namespace` this process's PID namespace, in which
 * a holder's processes are judged.
 */
export function readHolds(
  store: Store,
  worktree: WorktreeRecord | null,
  daemon: DaemonLiveness,
  now: EpochMs,
  namespace: string | null = pidNamespace(),
): StatusHold[] {
  return readKeyedHolds(store, worktree, daemon, now, namespace).map((k) => k.hold);
}

/** `readHolds`, each hold with its `id`. */
export function readKeyedHolds(
  store: Store,
  worktree: WorktreeRecord | null,
  daemon: DaemonLiveness,
  now: EpochMs,
  namespace: string | null = pidNamespace(),
): KeyedHold[] {
  if (worktree === null) return [];
  const startedAt = liveStartedAt(worktree, daemon);
  const row = startedAt === null ? null : readMergeHold(store, worktree.id, startedAt);
  const merge: KeyedHold[] =
    row === null
      ? []
      : [
          {
            id: "merge",
            hold: {
              cause: "merge",
              since: row.since,
              revision: row.revision,
              paths: row.paths,
              pathCount: Math.max(row.count, row.paths.length),
            },
          },
        ];
  const commands = readCommandHolds(store, worktree.id)
    .sort((a, b) => a.since - b.since)
    .map((entry): KeyedHold => {
      const recorded = [entry.wrapper, entry.child].filter((p): p is HarnessProcess => p !== null);
      const gone = recorded.length > 0 && recorded.every((p) => harnessGone(p, namespace));
      const hold: StatusHold = {
        cause: "command",
        since: entry.since,
        command: entry.command,
        pid: entry.child?.pid ?? entry.wrapper?.pid ?? null,
        until: entry.until,
        ...(gone ? { gone: true as const } : {}),
        ...(entry.until <= now ? { expired: true as const } : {}),
      };
      return { id: `command:${entry.token}`, hold };
    });
  return [...merge, ...commands];
}

/** `helper.ts`, `a, b, c and 2 more`: the first paths git lists, and how many more it lists. */
export function unmergedPathsText(hold: MergeHold): string {
  const shown = hold.paths.slice(0, HOLD_PATHS_SHOWN).join(", ");
  const more = hold.pathCount - Math.min(hold.paths.length, HOLD_PATHS_SHOWN);
  return more > 0 ? `${shown} and ${more} more` : shown;
}

/** `git lists 1 unmerged path (helper.ts)`. */
function listedText(hold: MergeHold): string {
  return `git lists ${plural(hold.pathCount, "unmerged path")} (${unmergedPathsText(hold)})`;
}

/** What ends a merge hold, as one sentence. */
export function mergeEndText(hold: MergeHold): string {
  const them = hold.pathCount === 1 ? "it" : "them";
  return `Resolve ${them} and \`git add\` ${them}, or abort.`;
}

/** `for \`npm run gate\` (pid 4242)`. */
function commandText(hold: CommandHold): string {
  return `for \`${hold.command}\`${hold.pid === null ? "" : ` (pid ${hold.pid})`}`;
}

/**
 * Why the daemon ends `hold` at its next heartbeat: its bound passed, or its
 * holder's processes are gone (C9), in the daemon's order of reasons
 * (`scheduler/command-hold.ts`); `null` while it holds.
 */
function endingText(hold: CommandHold): string | null {
  if (hold.expired === true) return `its bound passed at ${timeText(hold.until)}`;
  return hold.gone === true ? "its command is gone" : null;
}

/**
 * The `On hold:` line of one hold (C6 as amended 2026-10-21): its cause and
 * since when, what it names, and what ends it.
 */
export function holdLine(hold: StatusHold, command = "squeal"): string {
  const since = timeText(hold.since);
  if (hold.cause === "merge") {
    return `On hold: unresolved merge since ${since}, ${listedText(hold)}; no test runs until git lists none. ${mergeEndText(hold)}`;
  }
  const head = `On hold: \`${command} hold\` since ${since}, ${commandText(hold)}`;
  const ending = endingText(hold);
  if (ending !== null) return `${head}; ${ending}; the daemon ends the hold at its next heartbeat.`;
  return `${head}, until it exits, at most until ${timeText(hold.until)}; edits are recorded and not run. \`${command} start\` ends the hold.`;
}

/** Every hold's `On hold:` line, after the revision line. */
export function holdLines(holds: readonly StatusHold[] | undefined, command = "squeal"): string[] {
  return (holds ?? []).map((hold) => holdLine(hold, command));
}

/**
 * A wait's verdict line while its files are on hold (C6 as amended
 * 2026-10-21): the first hold, `no verdict`, and what ends it.
 */
export function holdVerdictLine(hold: StatusHold, command = "squeal"): string {
  if (hold.cause === "merge") {
    return `On hold: unresolved merge, ${listedText(hold)}; no verdict, since no test runs until git lists none. ${mergeEndText(hold)}`;
  }
  const head = `On hold: \`${command} hold\` ${commandText(hold)}`;
  const ending = endingText(hold);
  if (ending !== null) {
    return `${head}; no verdict: ${ending}, and the daemon ends the hold at its next heartbeat.`;
  }
  return `${head}, until it exits, at most until ${timeText(hold.until)}; no verdict, since edits are recorded and not run. \`${command} start\` ends the hold.`;
}

/**
 * What a file a hold keeps queued reads after `queued, ` (C15 as amended
 * 2026-10-21): `on hold for the unresolved merge (git lists helper.ts
 * unmerged)`, or ``on hold for `npm run gate` (pid 4242) until it exits``.
 */
export function onHoldText(hold: StatusHold): string {
  if (hold.cause === "merge") {
    return `on hold for the unresolved merge (git lists ${unmergedPathsText(hold)} unmerged)`;
  }
  return `on hold ${commandText(hold)} until it exits`;
}

/**
 * The line a delivery says when a hold starts (C8 as amended 2026-10-21),
 * after `SQUEAL · validation on hold at revision N: `.
 */
export function holdStartText(hold: StatusHold, command = "squeal"): string {
  if (hold.cause === "merge") {
    const them = hold.pathCount === 1 ? "it" : "them";
    return `${listedText(hold)}. No test runs until git lists none: resolve ${them} and \`git add\` ${them}, or abort.`;
  }
  const runs = `\`${command} hold\` runs \`${hold.command}\`${hold.pid === null ? "" : ` (pid ${hold.pid})`}`;
  return `${runs}. Edits are recorded and not run until it exits, at most until ${timeText(hold.until)}; \`${command} start\` ends the hold.`;
}

/** What ended, as a delivery names it: `git lists no unmerged path`, ``the hold for `npm run gate` (pid 4242) ended``. */
function endedText(ended: HoldEnded): string {
  if (ended.cause === "merge") return "git lists no unmerged path";
  const pid = ended.pid === undefined || ended.pid === null ? "" : ` (pid ${ended.pid})`;
  return `the hold for \`${ended.command}\`${pid} ended`;
}

/**
 * The line a delivery says when a hold ends and is not the last (review
 * 0.1.269, B2), after `SQUEAL · a hold ended at revision N: `: what ended,
 * and the first hold that still holds, if one does.
 */
export function holdEndedText(change: Extract<HoldChange, { kind: "ended" }>): string {
  const [first] = change.holds;
  if (first === undefined) return `${endedText(change.ended)}.`;
  const name = first.cause === "merge" ? "for the unresolved merge" : commandText(first);
  const more = change.holds.length - 1;
  return `${endedText(change.ended)}; still on hold ${name}${more > 0 ? ` and ${plural(more, "more hold")}` : ""}.`;
}

/**
 * The line a delivery says when the last hold ends, after `SQUEAL ·
 * validating again at revision N: `: what ended, and the test files that
 * wait to run.
 */
export function holdEndText(change: Extract<HoldChange, { kind: "resumed" }>): string {
  const running = change.running === 0 ? "" : `, ${change.running} running`;
  return `${endedText(change.ended)}; ${plural(change.queued, "test file")} queued${running}.`;
}
