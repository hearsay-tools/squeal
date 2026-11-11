import { join } from "node:path";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { NodeTestPrepare, NodeTestProject } from "../../types/policy.js";
import { type CancelSignals, type Ended, runCommand } from "./command.js";

/*
 * Spec 020 D15 (row 020-16b): a node:test entry's `prepare` command, such
 * as the build its tests start. The gate runs the base's declaration of the
 * entry with the same name, so a branch cannot add a command and run it in
 * the same change (D15.2). It runs once, before the entry's first selected
 * file, in the entry's directory with its `env`, inside the gate's one
 * budget and its own `timeoutSeconds` (D15.3). Its output goes to stderr.
 * Its success is never evidence (D15.4): it only lets the files run.
 */

/**
 * How an entry's `prepare` ended: `passed`, it exited 0; `failed`, another
 * exit, a signal, or it could not start; `timed-out`, its `timeoutSeconds`
 * or the budget ended first; `not-at-base`, only the head declares it, so
 * it did not run.
 */
export type PrepareOutcome = "passed" | "failed" | "timed-out" | "not-at-base";

/** D15.3, D7's `runs[].prepare`: one node:test entry's `prepare`. */
export interface PrepareRun {
  /** The `nodeTest` entry's name. */
  readonly project: string;
  /** The base's command; the head's when the base has none (`not-at-base`). */
  readonly command: readonly string[];
  readonly outcome: PrepareOutcome;
  /** Its exit code; `null` when it did not exit by itself or did not run. */
  readonly exit: number | null;
  /** How long it ran; `null` when it did not run. */
  readonly durationMs: number | null;
  /** The entry's selected test files that did not run because of it; empty when it passed. */
  readonly notRun: readonly RelativePath[];
}

/** D15.2: the base's `prepare` of each `nodeTest` entry, by the entry's name. */
export type BasePrepares = ReadonlyMap<string, NodeTestPrepare>;

/** The `prepare` of each `nodeTest` entry that has one. */
export function preparesOf(projects: readonly NodeTestProject[]): BasePrepares {
  return new Map(
    projects.flatMap((p) => (p.prepare === undefined ? [] : [[p.name, p.prepare] as const])),
  );
}

/** D15.2: whether `prepareEntry` handles `project`: the base or the head declares its `prepare`. */
export const declaresPrepare = (project: NodeTestProject, base: BasePrepares | undefined) =>
  base?.has(project.name) === true || project.prepare !== undefined;

export interface PrepareContext {
  readonly root: AbsolutePath;
  /** The gate's one deadline, a `performance.now()` time (D3.4). */
  readonly deadline: number;
  /** D15.2: read at the base; absent, the base declares none. */
  readonly base: BasePrepares | undefined;
  readonly note: (text: string) => void;
  /** The command's stdout and stderr, as they come (D15.3). */
  readonly output: (text: string) => void;
  /** The signals that cancel the gate; `process`'s when absent. */
  readonly signals?: CancelSignals;
}

/** What `prepareEntry` gives: the run, and whether the budget ended it. */
export interface Prepared {
  readonly run: PrepareRun;
  /** The gate's deadline, not the entry's own `timeoutSeconds`, stopped it or kept it from starting. */
  readonly budgetEnded: boolean;
}

const entryName = (project: NodeTestProject) => `node:test entry ${JSON.stringify(project.name)}`;
const notRunText = (n: number) =>
  n === 1 ? "its 1 selected test file does not run" : `its ${n} selected test files do not run`;

/**
 * D15.2, D15.3: the `prepare` of `project` before its selected `paths` run.
 * `null` when neither the base nor the head declares one: they run as
 * before. A head declaration the base lacks does not run, and a note says
 * to land it first. Otherwise the base's command runs; a failure or a
 * timeout keeps every one of `paths` from running.
 */
export async function prepareEntry(
  project: NodeTestProject,
  paths: readonly RelativePath[],
  context: PrepareContext,
): Promise<Prepared | null> {
  const base = context.base?.get(project.name);
  if (base === undefined) {
    if (project.prepare === undefined) return null;
    context.note(
      `${entryName(project)} declares a prepare command that the base does not, so it does not run and ${notRunText(paths.length)}. Land the declaration on the base branch first: the gate runs the base's prepare.`,
    );
    return {
      run: {
        project: project.name,
        command: project.prepare.command,
        outcome: "not-at-base",
        exit: null,
        durationMs: null,
        notRun: [...paths],
      },
      budgetEnded: false,
    };
  }
  const own = base.timeoutSeconds === undefined ? Infinity : base.timeoutSeconds * 1000;
  const left = Math.max(0, Math.floor(context.deadline - performance.now()));
  context.note(`${entryName(project)}: prepare: ${base.command.join(" ")}`);
  let last = "\n";
  const ended = await runCommand(base.command, {
    cwd: join(context.root, project.cwd ?? "."),
    env: { ...process.env, ...project.env },
    timeoutMs: Math.min(own, left),
    output: (text) => {
      if (text.length > 0) last = text;
      context.output(text);
    },
    ...(context.signals === undefined ? {} : { signals: context.signals }),
  });
  // The notes that follow start on a line of their own.
  if (!last.endsWith("\n")) context.output("\n");
  const outcome = ended.timedOut ? "timed-out" : ended.code === 0 ? "passed" : "failed";
  const budgetEnded = ended.timedOut && left <= own;
  if (outcome !== "passed") {
    const why = whyText(ended, budgetEnded, base);
    context.note(`${entryName(project)}: prepare ${why}: ${notRunText(paths.length)}`);
  }
  return {
    run: {
      project: project.name,
      command: base.command,
      outcome,
      exit: ended.timedOut ? null : ended.code,
      durationMs: ended.durationMs,
      notRun: outcome === "passed" ? [] : [...paths],
    },
    budgetEnded,
  };
}

function whyText(ended: Ended, budgetEnded: boolean, base: NodeTestPrepare): string {
  const after = `after ${(ended.durationMs / 1000).toFixed(1)} s`;
  if (ended.timedOut) {
    return budgetEnded
      ? `did not finish within the budget (${after})`
      : `did not finish within its timeoutSeconds, ${base.timeoutSeconds}`;
  }
  if (ended.error !== null) return `could not start: ${ended.error}`;
  if (ended.cancelled !== undefined) return `was stopped by ${ended.cancelled} ${after}`;
  if (ended.code === null) return `ended on ${ended.signal ?? "a signal"} ${after}`;
  return `exited ${ended.code} ${after}`;
}
