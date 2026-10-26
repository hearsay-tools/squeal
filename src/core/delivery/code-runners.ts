import { DESCRIPTIONS } from "../../runners/descriptions.js";
import { coverageOn, RECORDING_RUNNERS } from "../code/coverage/runtime.js";
import type { Policy } from "../types/index.js";

/*
 * Row 015-75 (spec 015 D6, D9): how Squeal's lines name the runners whose
 * runs give coverage records (`RECORDING_RUNNERS`) and those that give
 * none, by the names each runner's `describe.ts` gives (spec 016 D5).
 */

/** A runner's name, from the name its environment gives (`node-test`); that one for a runner Squeal does not describe. */
export function runnerName(runner: string): string {
  return DESCRIPTIONS.find((d) => d.runner === runner)?.name ?? runner;
}

/** The names of the runners whose runs give coverage records. */
export function recordingNames(): string[] {
  return DESCRIPTIONS.filter((d) => RECORDING_RUNNERS.has(d.runner)).map((d) => d.name);
}

/** While coverage is on, the names of the runners `policy` configures a project of whose runs give no records. */
export function notMeasuredNames(policy: Policy): string[] {
  if (!coverageOn(policy)) return [];
  return DESCRIPTIONS.filter(
    (d) => !RECORDING_RUNNERS.has(d.runner) && d.projects(policy).length > 0,
  ).map((d) => d.name);
}

/** `a`, `a or b`, `a, b or c`; `and` in place of `or` with `word`. */
export function joined(names: readonly string[], word: "and" | "or" = "or"): string {
  const last = names.at(-1) ?? "";
  return names.length < 2 ? last : `${names.slice(0, -1).join(", ")} ${word} ${last}`;
}

/** D9 as amended (row 015-75): `node:test gives no coverage`, `node:test and pytest give no coverage`. */
export function noCoverageWords(names: readonly string[]): string {
  return `${joined(names, "and")} ${names.length === 1 ? "gives" : "give"} no coverage`;
}
