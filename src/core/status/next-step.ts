import { loadText } from "../retry/text.js";
import { timeText } from "../text.js";
import { isSlowLane, SLOW_LANE_PREFIX, type Standing } from "../types/index.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20; `tasks/011-24/design.md`
 * section 3): what advances a test file without a verdict. One pure mapping
 * from the file's state, as the store has it, to the reason its group gives
 * and its next step: the command that advances it, or that none does and
 * why. The named class lines and the verdict line's groups read it.
 */

export type { KnownSetup, LoadNow, Standing } from "../types/index.js";

/** A file `retry` runs once: how many of the worktree's test files are not current, what `run --all --wait` runs. */
interface Retryable {
  readonly notCurrent?: number;
}

/**
 * What advances a group of files: `retry` runs them once (`again`: a
 * one-file rerun of a running slow file after an environment failure);
 * `command` names Squeal's own (`said`: the reason already names it),
 * `shell` another tool's; `none` says why nothing runs them sooner, or
 * nothing when nothing is needed. In `text`, `{command}` stands for the
 * command in backticks, `{squeal}` for the CLI, `{it}` for "it" or "them"
 * and `{its}` for "its" or "their".
 */
export type Step =
  | {
      readonly kind: "retry";
      readonly again?: true;
      readonly note?: string;
      /** The worktree's test files not current, which `run --all --wait` runs. */
      readonly all?: number;
    }
  | { readonly kind: "command"; readonly args: string; readonly text: string; readonly said?: true }
  | { readonly kind: "shell"; readonly command: string; readonly text: string }
  | { readonly kind: "none"; readonly text: string };

export interface NextStep {
  /** The class line's reason; `{it}` for "it" or "them", `{its}` for "its" or "their". */
  readonly reason: string;
  /** The verdict line's, shorter; its command follows it unless it names `{command}`. */
  readonly short: string;
  readonly step: Step;
}

/** Whether a named wait asks: a queued file there is already moved ahead as far as it goes. */
export interface StepContext {
  readonly named: boolean;
}

const NOT_INTERRUPTED = "no command runs {it} sooner (a running tier is not interrupted)";

/** `retry` runs it once; above `PATHS_IN_COMMAND` files the step names the full-suite run too. */
function retry(s: Retryable, note = ""): Step {
  return {
    kind: "retry",
    ...(note === "" ? {} : { note }),
    ...(s.notCurrent === undefined ? {} : { all: s.notCurrent }),
  };
}

/** Design 011-24 section 3's table, one row a state. */
export function nextStep(s: Standing, context: StepContext = { named: true }): NextStep {
  switch (s.kind) {
    case "no-daemon": {
      const since = s.since === null ? "" : ` since ${new Date(s.since).toISOString()}`;
      const reason = `no daemon has validated${since}; results are as of revision ${s.revision}`;
      return same(reason, { kind: "command", args: "start", text: "{command} starts one" });
    }
    case "unlisted":
      // None needed: the reason gives the bound; a named wait already waits, status names the wait.
      return same(
        `revision ${s.revision} not listed yet, because the runner part waits for the run in flight, each of its calls bounded at ${Math.ceil(s.callBoundMs / 1_000)} s`,
        context.named
          ? { kind: "none", text: "" }
          : { kind: "command", args: "status --wait 60000", text: "{command} waits for it" },
      );
    case "stale": {
      const last = s.verdict === null ? "ran" : LAST[s.verdict];
      return {
        reason: `last ${last} at other inputs, nothing queued {it}${lookupOnly(s.lookupOnly)}`,
        short: "stale, nothing queued {it}",
        step: retry(s),
      };
    }
    case "never-run":
      return {
        reason: `never run at {its} inputs, nothing queued {it}${lookupOnly(s.lookupOnly)}`,
        short: "never run, nothing queued {it}",
        step: retry(s),
      };
    case "timed-out": {
      const busy = s.load !== null && s.load.oneMinute !== null && s.load.oneMinute >= s.load.cpus;
      const note =
        busy && s.load !== null
          ? ` (${loadText(s.load)} now: under that load {it} may time out again)`
          : "";
      return {
        reason: `${s.reason}; Squeal does not run {it} again at these inputs by itself`,
        short: s.reason,
        step: retry(s, note),
      };
    }
    case "no-result":
      return { reason: s.reason, short: "no result at its inputs", step: retry(s) };
    case "setup-failed":
      return {
        reason: "its project's global setup failed",
        short: "its project's global setup failed",
        step: {
          kind: "command",
          args: "run --all --wait",
          text: "the next edit or {command} starts the runner again",
        },
      };
    case "runner":
      return {
        reason: s.reason,
        short: "no key, a runner call failed",
        step: {
          kind: "command",
          args: "run --all --wait",
          text: "the next edit or {command} calls the runner again",
        },
      };
    case "no-install":
      return same(
        "no dependencies are installed in this worktree",
        s.command === null
          ? { kind: "none", text: "a daemon runs {it} once the dependencies are installed" }
          : { kind: "shell", command: s.command, text: "{command} installs them" },
      );
    case "running":
      return runningStep(s);
    case "queued":
      return queuedStep(s, context);
    case "claim": {
      const until = s.until === null ? "" : `, at most until ${timeText(s.until)}`;
      return same(`waiting for ${s.worktree}'s run of its key${until}`, {
        kind: "none",
        text: "its result is shared here when that run stores it",
      });
    }
    case "slow": {
      const when = s.pausesOnly === true ? "when the agent pauses" : "after the fast tests";
      const reason = `slow, run ${when} or on {command}`;
      return {
        reason,
        // Under `slow.trigger: "idle"` the verdict line keeps when it runs (004-80).
        short: s.pausesOnly === true ? reason : "slow",
        step: { kind: "command", args: "run --slow", text: "", said: true },
      };
    }
    case "checkpoint":
      return same("a checkpoint in progress", {
        kind: "command",
        args: "run --all --wait",
        text: "{command} waits for it",
      });
  }
}

const LAST = { pass: "passed", fail: "failed", skip: "skipped" } as const;

function same(reason: string, step: Step): NextStep {
  return { reason, short: reason, step };
}

function lookupOnly(on: boolean): string {
  return on ? " (the baseline is lookup-only)" : "";
}

function runningStep(s: Extract<Standing, { kind: "running" }>): NextStep {
  const since = s.since === null ? "" : ` since ${timeText(s.since)}`;
  const several = s.files !== undefined && s.files > 1;
  // gh-40 run A: the store cannot tell whether a file of a several-file run has started.
  const where = several
    ? `in the ${laneText(s.lane)} tier of ${s.files} test files running${since}`
    : `running${since} in the ${laneText(s.lane)} lane`;
  if (isSlowLane(s.lane)) {
    // gh-46: what a slow pass's global setup started is not held; one file reruns on its own.
    const setup =
      s.setup === undefined
        ? ""
        : `; its project's global setup${s.setup.file === "" ? "" : ` (${s.setup.file})`} ran once when this slow pass started, and Squeal does not hold what it started, so another run of that project meanwhile may replace it`;
    return { reason: `${where}${setup}`, short: where, step: { kind: "retry", again: true } };
  }
  return same(where, { kind: "none", text: several ? NOT_INTERRUPTED : "" });
}

function queuedStep(s: Extract<Standing, { kind: "queued" }>, context: StepContext): NextStep {
  const promoted = s.promoted === true;
  if (s.behind === null) {
    if (promoted) return same("queued, promoted", { kind: "none", text: "" });
    return {
      reason: "queued; no run is open and nothing recorded holds {it}",
      short: "queued, nothing recorded holds {it}",
      step: {
        kind: "none",
        text: "the store records no reason the daemon has not taken {it} (`{squeal} status --json` lists each file's state)",
      },
    };
  }
  const of =
    s.files === undefined ? "" : ` of ${s.files === 1 ? "1 test file" : `${s.files} test files`}`;
  const tier = `behind the ${laneText(s.lane)} tier${of} running since ${timeText(s.behind)}`;
  const reason = promoted ? `queued, promoted, ${tier}` : `queued ${tier}`;
  return same(
    reason,
    context.named
      ? { kind: "none", text: NOT_INTERRUPTED }
      : {
          kind: "command",
          args: "status --wait 60000 <test file>",
          text: "{command} moves a named one ahead when that tier ends",
        },
  );
}

/** `vitest`, or `slow vitest` for a slow lane (004 D2). */
export function laneText(lane: string): string {
  if (!isSlowLane(lane)) return lane;
  const runner = lane.slice(SLOW_LANE_PREFIX.length);
  return runner === "" ? "slow" : `slow ${runner}`;
}
