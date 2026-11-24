import type { CoreEnvironmentInputs, TestFileRef } from "../../types/keys.js";
import type { FileCore, RunnerEnvironment, RunReport } from "../../types/runner.js";

/*
 * Spec 026 D10 (row 026-14): `environmentMode: "remote-key"`. A remote on
 * another platform, arch or allowed Node runs this worktree's tests, and the
 * daemon keys their results under the remote machine's own environment
 * (`RunnerEnvironment.core`), so a darwin key never holds a linux result
 * and a Linux CI export (spec 018) matches the remote's keys. Only the
 * machine's part of the environment may differ: its Node version, platform
 * and arch (`MACHINE`); config, projects, installed dependencies and the
 * allow-listed variables still equal this worktree's. The helpers here are
 * the seam the lane and the daemon wire.
 */

/** How a remote's environment must relate to this worktree's (`remote.json` `environmentMode`). */
export type EnvironmentMode = "match-local" | "remote-key";

/** The fields of a core that name the machine: what `remote-key` lets differ and keys under. */
export type MachineCore = Pick<CoreEnvironmentInputs, "nodeVersion" | "platform" | "arch">;

/** Whether `a` and `b` name the same machine: equal Node version, platform and arch. */
export function sameMachine(a: MachineCore, b: MachineCore): boolean {
  return a.nodeVersion === b.nodeVersion && a.platform === b.platform && a.arch === b.arch;
}

/** `core` with the Node version, platform and arch of `machine`; its other inputs stay. */
export function onMachine(
  core: CoreEnvironmentInputs,
  machine: MachineCore,
): CoreEnvironmentInputs {
  return {
    ...core,
    nodeVersion: machine.nodeVersion,
    platform: machine.platform,
    arch: machine.arch,
  };
}

/** Each environment keyed under `remoteCore`'s machine (D10.2); `null` leaves them as this worktree's. */
export function attachRemoteCore(
  environments: readonly RunnerEnvironment[],
  remoteCore: CoreEnvironmentInputs | null,
): RunnerEnvironment[] {
  return environments.map((environment) => {
    if (remoteCore === null) {
      if (environment.core === undefined) return environment;
      const { core: _, ...rest } = environment;
      return rest;
    }
    return { ...environment, core: remoteCore };
  });
}

/** `report` as run on `core`'s machine, every completed file with it. */
export function tagReportCore(report: RunReport, core: CoreEnvironmentInputs): RunReport {
  const { fileCores: _, ...rest } = report;
  return { ...rest, executedCore: core };
}

/**
 * `merged`, the report of split parts (some files here, some on the
 * remote), with each completed file's machine from the part that ran it,
 * as the report merge's rules give them.
 */
export function mergeCoreReports(merged: RunReport, parts: readonly RunReport[]): RunReport {
  const { executedCore: _a, fileCores: _b, ...rest } = merged;
  const executedCore = mergedExecutedCore(parts);
  const fileCores = mergedFileCores(parts);
  return {
    ...rest,
    ...(executedCore === undefined ? {} : { executedCore }),
    ...(fileCores === undefined ? {} : { fileCores }),
  };
}

/** The report merge's `executedCore`: the machine every part ran on, when each part names one. */
export function mergedExecutedCore(parts: readonly RunReport[]): CoreEnvironmentInputs | undefined {
  const first = parts[0]?.executedCore;
  if (first === undefined) return undefined;
  const one = parts.every(
    (p) =>
      p.fileCores === undefined &&
      p.executedCore !== undefined &&
      sameMachine(p.executedCore, first),
  );
  return one ? first : undefined;
}

/**
 * The report merge's `fileCores`, when the parts did not all run on one
 * machine: each completed file of a tagged part with its core. An untagged
 * part's files take none, so they count as run where the keys say.
 */
export function mergedFileCores(parts: readonly RunReport[]): readonly FileCore[] | undefined {
  if (mergedExecutedCore(parts) !== undefined) return undefined;
  const cores = parts.flatMap(coresOf);
  return cores.length === 0 ? undefined : cores;
}

/** Each completed file of `report` with the core it ran on, as tagged. */
function coresOf(report: RunReport): FileCore[] {
  if (report.fileCores !== undefined) return [...report.fileCores];
  const core = report.executedCore;
  if (core === undefined) return [];
  return report.completedFiles.map((testFile) => ({ testFile, core }));
}

/** The core `testFile` ran on in `report`; `undefined` when the report does not say. */
export function executedCoreOf(
  report: RunReport,
  testFile: TestFileRef,
): CoreEnvironmentInputs | undefined {
  const tagged = report.fileCores?.find(
    (f) => f.testFile.project === testFile.project && f.testFile.path === testFile.path,
  );
  return tagged?.core ?? report.executedCore;
}

/** D10.3: the status line naming the remote environment results are keyed to. */
export function remoteKeyStatusLine(target: string, remoteCore: MachineCore): string {
  const { platform, arch, nodeVersion } = remoteCore;
  return `remote ${target} (${platform}/${arch}, Node ${nodeVersion}); results keyed to remote environment`;
}

/** `platform/arch, Node version` of `core`, for texts naming a machine. */
export function machineText(core: MachineCore): string {
  return `${core.platform}/${core.arch}, Node ${core.nodeVersion}`;
}

/**
 * D10.2: why the remote's Node may not run this worktree's tests under
 * `remote-key`; `null` when it may. The remote's Node is this side's, or
 * meets every one of the project's `pins` (a `.node-version` or `.nvmrc`
 * value, `engines.node`). No pin: only this side's Node.
 */
export function nodeRefusal(remote: string, local: string, pins: readonly string[]): string | null {
  if (remote === local) return null;
  if (pins.length === 0) return `Node ${remote} on the remote, ${local} here`;
  const unmet = pins.filter((pin) => meetsPin(remote, pin) !== true);
  if (unmet.length === 0) return null;
  const named = unmet.map((pin) => JSON.stringify(pin)).join(", ");
  return `Node ${remote} on the remote does not meet the project's Node pin ${named} (${local} here)`;
}

type Version = readonly [number, number, number];

/** A comparator of a range: `>=26`, `^26.1`, `26.x`; parts after a wildcard are not given. */
const COMPARATOR =
  /^(>=|<=|>|<|=|\^|~)?v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-[0-9A-Za-z.-]+)?$/;

/**
 * Whether Node `version` (`v26.13.0`) meets `pin`: an exact or partial
 * version (`26.13.0`, `v26`, `26.x`), or a range of `||` alternatives of
 * comparators (`>=`, `>`, `<=`, `<`, `=`, `^`, `~`). `null`: a pin this
 * does not read, such as the alias `lts/*` or a hyphen range.
 */
export function meetsPin(version: string, pin: string): boolean | null {
  const have = exactVersion(version);
  if (have === null) return false;
  let met = false;
  for (const alternative of pin.split("||")) {
    const comparators = alternative
      .trim()
      .replace(/(>=|<=|>|<|=|\^|~)\s+/g, "$1")
      .split(/\s+/)
      .filter((c) => c !== "");
    let all = true;
    for (const comparator of comparators) {
      const answer = meets(have, comparator);
      if (answer === null) return null;
      all &&= answer;
    }
    met ||= all;
  }
  return met;
}

function exactVersion(text: string): Version | null {
  const found = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (found === null) return null;
  return [Number(found[1]), Number(found[2]), Number(found[3])];
}

/** Whether `have` meets one comparator; `null` when it is not one. */
function meets(have: Version, comparator: string): boolean | null {
  const found = COMPARATOR.exec(comparator);
  if (found === null) return null;
  const given: number[] = [];
  for (const part of found.slice(2, 5)) {
    if (part === undefined || !/^\d+$/.test(part)) break;
    given.push(Number(part));
  }
  const op = found[1] ?? "=";
  // A bare wildcard (`*`, `x`) names every version, except as a bound below it.
  if (given.length === 0) return op !== "<" && op !== ">";
  const test = OPERATORS[op];
  return test === undefined ? null : test(have, given);
}

/** Each comparator's test of `have` against the parts it gives. */
const OPERATORS: Record<string, (have: Version, given: readonly number[]) => boolean> = {
  "=": (have, given) => given.every((part, i) => have[i] === part),
  ">=": (have, given) => order(have, fill(given)) >= 0,
  ">": (have, given) =>
    given.length === 3 ? order(have, fill(given)) > 0 : order(have, bump(given)) >= 0,
  "<": (have, given) => order(have, fill(given)) < 0,
  "<=": (have, given) =>
    given.length === 3 ? order(have, fill(given)) <= 0 : order(have, bump(given)) < 0,
  "^": (have, given) => order(have, fill(given)) >= 0 && have[0] === given[0],
  "~": (have, given) => order(have, fill(given)) >= 0 && order(have, bump(given.slice(0, 2))) < 0,
};

/** `parts` with zeros for the parts not given. */
function fill(parts: readonly number[]): Version {
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
}

/** The first version after every version `parts` names: `26` → `27.0.0`, `26.1` → `26.2.0`. */
function bump(parts: readonly number[]): Version {
  const up = [...parts];
  up[up.length - 1] = (up[up.length - 1] ?? 0) + 1;
  return fill(up);
}

function order(a: Version, b: Version): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}
