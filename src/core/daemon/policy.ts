import { join } from "node:path";
import { isRecord } from "../fs/index.js";
import { readDaemonNotes } from "../notes.js";
import {
  DEFAULT_POLICY,
  type LoadedPolicy,
  type Policy,
  type Store,
  type WorktreeId,
} from "../types/index.js";
import {
  describeProblems,
  type Leaf,
  loadConfigFile,
  positiveInteger,
  type Shape,
} from "./config-file.js";
import { CODE_SHAPE } from "./policy-code.js";
import { LINT_SHAPE } from "./policy-lint.js";
import { compiles, nodeTestProjects } from "./policy-node-test.js";
import { pytestProjects } from "./policy-pytest.js";
import { slowInclude } from "./policy-slow.js";

export { describeProblems };

/** Spec 001 D11: "`squeal.config.json` at the repository root, committed, all keys optional". */
export const POLICY_FILE = "squeal.config.json";

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");
const strings: Leaf = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
/**
 * Spec 001 D11 as amended: a list for every test file, or a map from
 * test-file glob to input globs. Every glob must compile, so a typo is a
 * problem when the file is read, not a daemon that cannot key.
 */
const inputs: Leaf = (v) => {
  const isList = strings(v) === null;
  if (!isList && !(isRecord(v) && Object.values(v).every((globs) => strings(globs) === null))) {
    return "an array of strings, or an object from test-file glob to an array of strings";
  }
  const globs = isList
    ? (v as string[])
    : Object.entries(v as Record<string, string[]>).flatMap(([test, input]) => [test, ...input]);
  return compiles(globs);
};

const atLeastZero: Leaf = (v) => (isNumber(v) && v >= 0 ? null : "a number >= 0");
const aboveZero: Leaf = (v) => (isNumber(v) && v > 0 ? null : "a number > 0");
const orNull =
  (leaf: Leaf): Leaf =>
  (v) => {
    const expected = v === null ? null : leaf(v);
    return expected === null || typeof expected === "object" ? expected : `${expected}, or null`;
  };
const oneOf =
  (...values: readonly string[]): Leaf =>
  (v) =>
    values.includes(v as string) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;

/** Every key of `Policy`, mirroring `DEFAULT_POLICY`. */
const SHAPE: Shape = {
  interrupt: { onRegression: boolean },
  stop: {
    blockOnKnownFailures: boolean,
    requireFullSuite: boolean,
    waitMs: atLeastZero,
    requireSlowSuite: boolean,
    slowWaitMs: atLeastZero,
  },
  testCommand: { denyWhenCurrent: boolean },
  baseline: { onStart: oneOf("lookup-then-run-missing", "lookup-only") },
  inputs,
  observe: { runtimeInputs: boolean },
  env: { allowlist: strings },
  runner: {
    tierSize: positiveInteger,
    backlogTierSize: positiveInteger,
    timeoutMs: orNull(positiveInteger),
  },
  nodeTest: (v) => nodeTestProjects(v, "nodeTest"),
  pytest: (v) => pytestProjects(v, "pytest"),
  vitest: { excludeProjects: strings, exclude: (v) => strings(v) ?? compiles(v as string[]) },
  slow: {
    include: slowInclude,
    maxWorkers: positiveInteger,
    maxLoadPerCpu: aboveZero,
    maxDeferMs: atLeastZero,
    maxParallel: positiveInteger,
    rank: oneOf("tokens", "duration"),
    // Spec 004 D2, D7 as amended 2026-10-18 (row 004-80).
    trigger: oneOf("continuous", "idle"),
    quietMs: atLeastZero,
  },
  delivery: { uncoveredEdits: boolean },
  daemon: { idleExitMinutes: aboveZero, unusedExitMinutes: aboveZero },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) },
  ...CODE_SHAPE,
  ...LINT_SHAPE,
};

/**
 * Reads `squeal.config.json` from the worktree root and applies it over
 * `DEFAULT_POLICY`. The one loader of daemon and hooks; never throws.
 *
 * Spec 001 D11: "unknown keys and wrong types are reported as problems, the
 * defaults apply for those keys". A missing file is the defaults with no
 * problems. A file that cannot be read, is not JSON or is not an object is
 * the defaults with one problem.
 */
export function loadPolicy(root: string): LoadedPolicy {
  const loaded = loadConfigFile(join(root, POLICY_FILE), SHAPE, DEFAULT_POLICY);
  return {
    policy: loaded.value,
    problems: loaded.problems,
    ...(loaded.unparsed === true ? { unparsed: true } : {}),
  };
}

/** The policy alone, for callers that act on it and leave reporting to the daemon (the hooks). */
export function readPolicy(root: string): Policy {
  return loadPolicy(root).policy;
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Text of the newest persisted note about `file` (default `squeal.config.json`), or `null`. */
export function lastPolicyNote(
  store: Store,
  worktreeId: WorktreeId,
  file: string = POLICY_FILE,
): string | null {
  const texts = readDaemonNotes(store, worktreeId).map((note) => note.text);
  return texts.findLast((text) => text.startsWith(file)) ?? null;
}
