import { testFileId } from "../core/keys/reverse-index.js";
import { groupView, runnerOf } from "../core/scheduler/slow.js";
import type { CheckRunner } from "../core/types/check-groups.js";
import type { TestFileRef } from "../core/types/keys.js";
import type { Policy } from "../core/types/policy.js";
import type { SideState } from "./status-at-report.js";

/*
 * Row 023-29 (lessons round 4, R3): a batch whose setup failed is not a
 * budget cut. In round 4 the browser group's global setup could not launch
 * Chrome: "0 of 108 ran" after 70 s, yet the report said "108 not run
 * (budget)" and offered a longer `--timeout`, which 4 of 5 sessions took
 * and failed the same way. The gate tells a run that failed to start in
 * one note (`<runner> run: <failure>`, `lanes.ts`); the run's child keeps
 * those notes in its answer (`setupOf`), and the batch's files of that
 * runner that did not run read `not run (setup)` with the group and the
 * failure. A group whose setup failed runs no later batch in this call.
 * Groups that run only on request (`at: "manual"`, `squeal checks` shows
 * them) run in batches of their own (`lotOf`), so their setup cannot stop
 * the other files.
 */

/** One run of a batch that failed to start: the gate's runner kind and its failure line. */
export interface SetupFailure {
  readonly runner: string;
  readonly text: string;
}

const SETUP_NOTE = /^(\S+) run: ((?:the run failed to start|global setup .+ failed): .*)$/s;

/** The setup failure a gate note tells; `null` for any other note. */
export function setupOf(note: string): SetupFailure | null {
  const match = SETUP_NOTE.exec(note.trim());
  if (match === null) return null;
  const [, runner = "", text = ""] = match;
  const first = text.split("\n")[0] ?? "";
  return { runner, text: first.replace(/^the run failed to start: /, "") };
}

/** The gate's runner kind as the policy names it (`node-test` is `nodeTest`). */
const runnerKind = (runner: string): CheckRunner =>
  runner === "node-test" ? "nodeTest" : (runner as CheckRunner);

/**
 * The batch lot of a file: the name of a group that runs only on request,
 * else `""`, the lot of every other file. A batch holds one lot.
 */
export function lotOf(policy: Policy): (ref: TestFileRef) => string {
  const view = groupView(policy);
  return (ref) => {
    const group = view.of(ref);
    return group.at === "manual" ? group.name : "";
  };
}

/** What one batch's setup failures decide: each failed file's state, and what stops later batches. */
export interface SetupVerdict<F> {
  /** By `testFileId`. */
  readonly states: ReadonlyMap<string, SideState>;
  /** Whether a file later batches would run is under a failed setup; then its state. */
  readonly stops: (file: F) => SideState | null;
}

/**
 * The batch's files of a runner that failed to start, which `read` (the
 * read-back state) has as `not run`: `not run (setup)`, with their group
 * and the failure.
 */
export function setupVerdict<F>(
  policy: Policy,
  failures: readonly SetupFailure[],
  files: readonly F[],
  refOf: (file: F) => TestFileRef,
  read: (file: F) => SideState | undefined,
): SetupVerdict<F> {
  const byRunner = new Map(failures.map((f) => [runnerKind(f.runner), f.text]));
  const view = groupView(policy);
  const failed = new Map<string, string>();
  const states = new Map<string, SideState>();
  const keyOf = (ref: TestFileRef) => `${view.of(ref).name}\0${runnerOf(policy, ref.project)}`;
  for (const file of files) {
    const ref = refOf(file);
    const text = byRunner.get(runnerOf(policy, ref.project));
    if (text === undefined || read(file)?.state !== "not run") continue;
    const setup = `${view.of(ref).name}: ${text}`;
    failed.set(keyOf(ref), setup);
    states.set(testFileId(ref), { state: "not run", reason: "setup", setup });
  }
  const stops = (file: F): SideState | null => {
    const setup = failed.get(keyOf(refOf(file)));
    return setup === undefined ? null : { state: "not run", reason: "setup", setup };
  };
  return { states, stops };
}
