import type { RetryOutcome } from "../core/retry/index.js";
import { fromBase } from "../core/status/next-step-text.js";
import { plural, shellWord } from "../core/text.js";
import type { AskedEnd } from "./status-wait-ask.js";

/*
 * Row 011-207's texts for the runs a named wait asked (011 C15): its lines
 * and its JSON entries. Row 011-241 moved them from `status-wait-ask.ts`.
 */

/**
 * One asked run in `selection.asked` (row 011-207, additive): whether its
 * request was pending at the last read, else how it ended.
 */
export interface AskedPayload {
  readonly project: string;
  readonly path: string;
  readonly pending: boolean;
  readonly outcome?: RetryOutcome;
}

/**
 * `selection.asked` and `wait.asked`: one entry per file whose request this
 * wait stored, absent when it stored none (C15). A busy store's refusal is
 * no asked run (review 0.1.322 B3); only the `Run not asked:` line names it.
 */
export function askedPayload(
  ends: readonly AskedEnd[] | undefined,
): readonly AskedPayload[] | undefined {
  const stored = (ends ?? []).filter((e) => e.answer === "queued");
  if (stored.length === 0) return undefined;
  return stored.map((e) => ({
    project: e.testFile.project,
    path: e.testFile.path,
    pending: e.pending,
    ...(e.outcome === undefined ? {} : { outcome: e.outcome }),
  }));
}

/**
 * The runs a wait's lines name (`askedLines`), none when it stored no
 * request and found the store busy for none: its own requests, the ones it
 * joined, and the busy refusals.
 */
export function waitAsked(ends: readonly AskedEnd[]): readonly AskedEnd[] | undefined {
  if (!ends.some((e) => e.answer === "queued" || e.answer === "busy")) return undefined;
  return ends.filter((e) => e.answer === "queued" || e.answer === "joined" || e.answer === "busy");
}

/**
 * The `Run asked:` line (row 011-207), none when this wait stored no
 * request: each file it asked for, as `retry` would name it from `base`;
 * when a run had not ended at the last read, that it is pending. A busy
 * store's files get a line apart, with the command that asks them.
 */
export function askedLines(
  ends: readonly AskedEnd[] | undefined,
  command: string,
  base?: string,
): string[] {
  const queued = (ends ?? []).filter((e) => e.answer === "queued");
  const busy = (ends ?? []).filter((e) => e.answer === "busy");
  const shown = (of: readonly AskedEnd[]) => of.map((e) => fromBase(base, e.testFile.path));
  const lines: string[] = [];
  if (queued.length > 0) lines.push(`Run asked: ${queuedText(queued, shown(queued), command)}`);
  if (busy.length > 0) {
    const paths = shown(busy);
    const them = busy.length === 1 ? "it" : "them";
    lines.push(
      `Run not asked: ${paths.join(", ")}: the store stayed busy; \`${command} retry ${paths.map(shellWord).join(" ")}\` asks ${them}.`,
    );
  }
  return lines;
}

function queuedText(queued: readonly AskedEnd[], paths: readonly string[], command: string) {
  const pending = queued.filter((e) => e.pending);
  if (queued.length === 1) {
    const [only] = queued as [AskedEnd];
    const [path] = paths as [string];
    const tail = !only.pending
      ? ""
      : only.untaken
        ? "; the run is pending: the daemon has not taken the request yet"
        : "; the run is pending";
    return `${path} was ${only.state} with nothing queued, so this wait asked its one run at these inputs, as \`${command} retry ${shellWord(path)}\` does${tail}.`;
  }
  const states = new Set(queued.map((e) => e.state));
  const were = states.size === 2 ? "stale or unknown" : [...states][0];
  const tail =
    pending.length === 0
      ? ""
      : pending.length === 1
        ? `; 1 run is pending: ${paths[queued.indexOf(pending[0] as AskedEnd)]}`
        : `; ${pending.length} runs are pending: ${pending.map((e) => paths[queued.indexOf(e)]).join(", ")}`;
  return `${plural(queued.length, "test file")} were ${were} with nothing queued, so this wait asked one run of each at these inputs, as \`${command} retry\` does: ${paths.join(", ")}${tail}.`;
}
