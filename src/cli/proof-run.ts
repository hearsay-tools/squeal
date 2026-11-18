import { join } from "node:path";
import type { Checkout } from "../core/checkout/checkout.js";
import { FILE_ERROR } from "../core/code/gate/evidence.js";
import type { FailedTest } from "../core/code/gate/types.js";
import { type KeyedFile, resultsAt, withStores } from "../core/commit/at-keys-checkout.js";
import { compare } from "../core/fs/compare.js";
import { testFileId } from "../core/keys/reverse-index.js";
import { conditionedEnv, hasConditions, hiddenInHome, ownHome } from "../core/proof/conditions.js";
import { NOT_RUN_BUDGET, type SideEnd } from "../core/proof/verdict.js";
import type { RelativePath } from "../core/types/common.js";
import type { ResultRecord } from "../core/types/store-records.js";
import type { GateFileRun } from "./code-gate-files.js";
import type { SideFile, SideInput } from "./proof-side.js";
import type { SideState } from "./status-at-report.js";
import { type RunAnswer, runInChild } from "./status-at-run-child.js";
import { outcomesOf } from "./status-at-run-outcome.js";

/*
 * Spec 023 D5.1, D5.3, D5.4 (rows 023-08, 023-11): a side's runs in its
 * open checkout through 023-07's child (`runInChild`), read back as 023-07
 * reads them (`outcomesOf`). A forced side (under a condition, or
 * repeated) runs with `store: false` and is read from the run's own
 * answer, never from the store. With `--repeat n` each file runs up to n
 * times and stops at its first run that does not pass: the red side's
 * first failure, or the green side's. The budget covers every run; a run
 * not started reads `not run (budget)`.
 */

/** Why a forced side's run is not stored, as the report says it. */
export function forcedReason(input: SideInput): string | null {
  if (hasConditions(input.conditions)) return "a side under a condition is never stored";
  if (input.repeat > 1) return "a repeated side is not stored";
  return null;
}

/**
 * Runs `toRun` in the open checkout up to `input.repeat` times each, each
 * file's side into `files`; how many file runs were made.
 */
export async function runFiles(
  input: SideInput,
  checkout: Checkout,
  toRun: readonly KeyedFile[],
  change: RelativePath | null,
  files: Map<string, SideFile>,
): Promise<number> {
  const env = runEnv(input, checkout);
  const runs = new Map<string, number>();
  let left = toRun;
  let made = 0;
  for (let round = 0; round < input.repeat && left.length > 0; round++) {
    const seconds = Math.floor((input.deadline - performance.now()) / 1000);
    if (seconds < 1) {
      for (const file of left) {
        const id = testFileId(file.ref);
        files.set(id, { ...budgetSide(), runs: runs.get(id) ?? 0 });
      }
      break;
    }
    const sides = await runOnce(input, checkout, left, change, env, seconds);
    const next: KeyedFile[] = [];
    for (const file of left) {
      const id = testFileId(file.ref);
      const side = sides.get(id) ?? budgetSide();
      const count = (runs.get(id) ?? 0) + (side.from === "run" ? 1 : 0);
      runs.set(id, count);
      if (side.from === "run") made++;
      files.set(id, { ...side, runs: count });
      if (side.end.end === "pass") next.push(file);
    }
    left = next;
  }
  return made;
}

/** The run's environment: the command's, with the conditions, and its own `HOME` when one is hidden there. */
function runEnv(input: SideInput, checkout: Checkout): NodeJS.ProcessEnv {
  const hidden = hiddenInHome(input.conditions);
  const real = input.env.HOME;
  if (hidden.length === 0 || real === undefined || real === "")
    return conditionedEnv(input.env, input.conditions, null);
  // In the checkout's folder: its removal, or the next sweep, removes it with the checkout.
  const home = join(checkout.folder, "home");
  ownHome(real, hidden, home);
  return conditionedEnv(input.env, input.conditions, home);
}

function budgetSide(): SideFile {
  return {
    end: { end: "unknown", reason: NOT_RUN_BUDGET },
    from: null,
    stored: false,
    notStored: null,
    runs: 0,
  };
}

/** One run of `toRun` in the open checkout; each file's side by `testFileId`. */
async function runOnce(
  input: SideInput,
  checkout: Checkout,
  toRun: readonly KeyedFile[],
  change: RelativePath | null,
  env: NodeJS.ProcessEnv,
  seconds: number,
): Promise<Map<string, SideFile>> {
  const forced = forcedReason(input);
  const answer = await runInChild({
    relaunch: input.relaunch,
    checkout,
    files: [...new Set(toRun.map((f) => f.ref.path))].sort(),
    budgetSeconds: seconds,
    // "Whole-checkout check": a checkout that is not the side's expected tree stores nothing;
    // D5.3: nor does a side under a condition, whose key does not record it.
    store: forced === null && change === null,
    env,
    forward: input.forward,
  });
  const states = await outcomesOf({
    commonDir: checkout.commonDir,
    commit: input.side.code,
    own: input.own,
    run: toRun,
    siblings: [],
    answer,
    changed: change,
    stored: forced === null,
  });
  const out = new Map<string, SideFile>();
  // Review wave-9 B3: a change the install made is named, never masked by the forced reason.
  const notStored = change === null ? forced : `install changed the checkout: ${change}`;
  // Review wave-8 B1: a stored run's failures are its own project's, read at its own key.
  await withStores(checkout.commonDir, async (main) => {
    for (const file of toRun) {
      const state = states.get(testFileId(file.ref));
      const records =
        main !== null && forced === null && "key" in file.at
          ? resultsAt(main, file.ref, file.at.key)
          : [];
      out.set(testFileId(file.ref), ranSide(state, answer, file.ref.path, notStored, records));
    }
  });
  return out;
}

function unknown(reason: string): SideFile {
  return { end: { end: "unknown", reason }, from: null, stored: false, notStored: null, runs: 0 };
}

/** A file's side from the results stored at its key: fail when one failed, with their errors. */
export function endOfRecords(records: readonly ResultRecord[]): SideEnd {
  const failed = records.filter((r) => r.outcome === "fail");
  if (failed.length === 0) return { end: "pass" };
  const byTest = new Map<string, FailedTest>();
  for (const r of failed) {
    const test = r.check.kind === "test" ? r.check.fullName : FILE_ERROR;
    const errors = [...(byTest.get(test)?.errors ?? []), ...r.errors];
    byTest.set(test, { test, errors });
  }
  return { end: "fail", failures: [...byTest.values()].sort((a, b) => compare(a.test, b.test)) };
}

/**
 * A run file's side from 023-07's state. A stored outcome takes its
 * failures from `records`, the results at the file's own key for its own
 * project. An outcome the store does not hold takes them from the gate's
 * answer, which is by path: a path two projects ran takes them only when
 * every project's failure evidence is the same, test by test and error by
 * error, as the report shows it (review wave-8 B1, and its re-review: equal
 * kinds are not equal evidence). Otherwise the file reads unknown, and
 * still counts as run.
 */
function ranSide(
  state: SideState | undefined,
  answer: RunAnswer,
  path: RelativePath,
  notStored: string | null,
  records: readonly ResultRecord[],
): SideFile {
  const runs: readonly GateFileRun[] =
    "result" in answer ? answer.result.runs.filter((r) => r.path === path) : [];
  if (state === undefined) return unknown("the run gave it no outcome");
  if ((state.state === "pass" || state.state === "fail") && state.origin.stored === true) {
    if (records.length === 0) return unknown("its stored result could not be read back");
    return { end: endOfRecords(records), from: "run", stored: true, notStored: null, runs: 1 };
  }
  const ranAs = (outcome: "pass" | "fail"): SideFile => {
    if (outcome === "pass") return { ...unstored(notStored), end: { end: "pass" } };
    const failures = sharedFailures(runs);
    if (failures === null)
      return {
        ...unstored(notStored),
        end: {
          end: "unknown",
          reason: `its ${runs.length} projects failed with different failures, and no stored result tells which is this project's`,
        },
      };
    return { ...unstored(notStored), end: { end: "fail", failures } };
  };
  if (state.state === "pass" || state.state === "fail") return ranAs(state.state);
  if (state.state === "not comparable" && state.ran !== undefined) return ranAs(state.ran);
  if (state.state === "not run") {
    // 023-07's `fromGate` gives `not run` only when every project's run of the path agrees.
    if (state.reason === "prepare")
      return { ...unknown(""), end: { end: "prepare" }, from: "run", runs: 1 };
    if (runs.length > 0 && runs.every((r) => r.outcome === "not-finished"))
      return { ...unknown(""), end: { end: "timeout" }, from: "run", runs: 1 };
    return unknown(NOT_RUN_BUDGET);
  }
  if (state.state === "not determined" || state.state === "not comparable")
    return unknown(state.reason);
  return unknown(state.state);
}

function unstored(notStored: string | null): Omit<SideFile, "end"> {
  return {
    from: "run",
    stored: false,
    notStored: notStored ?? "the gate keeps a result only with coverage on",
    runs: 1,
  };
}

/**
 * The failures of a path's runs when every run failed with the same
 * evidence: the same tests, each with the same errors (name, message,
 * stack, diff, code, causes, phase), so any one project's failures are
 * this project's word for word; `null` otherwise. A timeout's recorded
 * load is the host's, not the test's, and is left out of the comparison.
 */
function sharedFailures(runs: readonly GateFileRun[]): readonly FailedTest[] | null {
  const [first] = runs;
  if (first === undefined || runs.some((r) => r.outcome !== "failed")) return null;
  const evidence = (r: GateFileRun) =>
    JSON.stringify(
      r.failed.map((f) => [f.test, f.errors.map(({ loadAverage: _load, ...error }) => error)]),
    );
  return runs.every((r) => evidence(r) === evidence(first)) ? first.failed : null;
}
