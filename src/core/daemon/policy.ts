import { join } from "node:path";
import { isRecord } from "../fs/json.js";
import { readDaemonNotes } from "../notes.js";
import { keyingDeferred } from "../scheduler/deferred-keying.js";
import type { WorktreeId } from "../types/common.js";
import {
  type DaemonExits,
  DEFAULT_POLICY,
  type LoadedPolicy,
  type Policy,
} from "../types/policy.js";
import type { Store } from "../types/store.js";
import {
  describeProblems,
  type Leaf,
  type LoadedConfig,
  loadConfigFile,
  positiveInteger,
  type Shape,
} from "./config-file.js";
import { hostIdleMinutes } from "./host-idle.js";
import { checkGroups } from "./policy-checks.js";
import { settleChecks } from "./policy-checks-settle.js";
import { CODE_SHAPE } from "./policy-code.js";
import { containerTargets, settleContainers } from "./policy-containers.js";
import { GATE_SHAPE } from "./policy-gate.js";
import { jestProjects } from "./policy-jest.js";
import { LINT_SHAPE } from "./policy-lint.js";
import { NODE_SHAPE } from "./policy-node.js";
import { compiles, nodeTestProjects } from "./policy-node-test.js";
import { pytestProjects } from "./policy-pytest.js";
import { REMOTE_SHAPE } from "./policy-remote.js";
import { runtimeFiles } from "./policy-runtime.js";
import { SHARED_SHAPE } from "./policy-shared.js";
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
    // Spec 019 D4 step 3.
    maxHolds: positiveInteger,
  },
  // Spec 019 D1.
  checks: checkGroups,
  testCommand: { denyWhenCurrent: boolean },
  baseline: { onStart: oneOf("lookup-then-run-missing", "lookup-only") },
  inputs,
  runtimeFiles,
  observe: { runtimeInputs: boolean },
  env: { allowlist: strings },
  runner: {
    tierSize: positiveInteger,
    backlogTierSize: positiveInteger,
    timeoutMs: orNull(positiveInteger),
    // Spec 021 D20.4 (row 021-26).
    hostIdleMinutes: orNull(hostIdleMinutes),
  },
  nodeTest: (v) => nodeTestProjects(v, "nodeTest"),
  pytest: (v) => pytestProjects(v, "pytest"),
  // Spec 028 D1 (row 028-05).
  jest: (v) => jestProjects(v, "jest"),
  // Spec 027 D4 (row 027-04).
  containers: containerTargets,
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
  daemon: {
    idleExitMinutes: aboveZero,
    unusedExitMinutes: aboveZero,
    // Spec 023 D7.4 (row 023-40).
    maxCommitDaemons: orNull(positiveInteger),
  },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) },
  ...CODE_SHAPE,
  ...LINT_SHAPE,
  ...SHARED_SHAPE,
  ...REMOTE_SHAPE,
  ...GATE_SHAPE,
  ...NODE_SHAPE,
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
  const loaded = loadConfigFile(join(root, POLICY_FILE), SHAPE, UNSET_EXITS);
  // Row 025-18: the same load (the file's text unchanged) settles to the same policy.
  const last = lastPolicies.get(root);
  if (last?.loaded === loaded) return last.policy;
  const policy = settle(loaded);
  lastPolicies.set(root, { loaded, policy });
  return policy;
}

/** Row 025-18: each root's last policy and the load it was settled from (`loadConfigFile`). */
const lastPolicies = new Map<string, { readonly loaded: object; readonly policy: LoadedPolicy }>();

function settle(loaded: LoadedConfig<Policy>): LoadedPolicy {
  // Spec 028 D1: a Jest project's name is unique across the runners.
  const named = settleJestNames(loaded.value);
  // Spec 027 D4: each project's `container` names a declared target.
  const contained = settleContainers(named.policy);
  // Spec 019 D1: what `checks` needs from the other keys and among its groups.
  const settled = settleChecks(contained.policy);
  return {
    policy: withExits(
      settled.problems.length === 0
        ? contained.policy
        : { ...contained.policy, checks: settled.checks },
    ),
    problems: [...loaded.problems, ...named.problems, ...contained.problems, ...settled.problems],
    ...(loaded.unparsed === true ? { unparsed: true } : {}),
    ...(loaded.unknownKeys === undefined ? {} : { unknownKeys: loaded.unknownKeys }),
  };
}

/**
 * Spec 028 D1: project names are unique across the runners. A `jest` entry
 * whose name a `nodeTest` or `pytest` project holds is one problem and is
 * skipped (001 D11); the other lists stay as they load, and `jestProjects`
 * already skips a name repeated within `jest`. Returns `policy` itself when
 * none is.
 */
function settleJestNames(policy: Policy): {
  readonly policy: Policy;
  readonly problems: readonly string[];
} {
  if (policy.jest.length === 0) return { policy, problems: [] };
  const taken = new Set([...policy.nodeTest, ...policy.pytest].map((project) => project.name));
  const problems: string[] = [];
  const jest = policy.jest.filter((project) => {
    if (!taken.has(project.name)) return true;
    problems.push(
      `"jest" project ${JSON.stringify(project.name)} has the name of another project, and names are unique across runners; it is skipped`,
    );
    return false;
  });
  return { policy: jest.length === policy.jest.length ? policy : { ...policy, jest }, problems };
}

/**
 * The defaults with both daemon exits unset: `NaN`, which no JSON value is
 * and a bad value leaves in place, so `withExits` tells a key the file sets.
 */
const UNSET_EXITS: Policy = {
  ...DEFAULT_POLICY,
  daemon: { ...DEFAULT_POLICY.daemon, idleExitMinutes: Number.NaN, unusedExitMinutes: Number.NaN },
};

/**
 * Spec 026 D2.2: the defaults in place of an unset exit bound, and which
 * bounds the file sets (`daemon.set`, absent when neither). The bounds the
 * daemon keeps are `daemonExits`'s, outside the loader, so the key path
 * that loads a policy holds no scheduler code (`test/keys/key-format.test.ts`).
 */
function withExits(policy: Policy): Policy {
  const { idleExitMinutes: idle, unusedExitMinutes: unused } = policy.daemon;
  const defaults = DEFAULT_POLICY.daemon;
  const set = { idleExitMinutes: !Number.isNaN(idle), unusedExitMinutes: !Number.isNaN(unused) };
  const daemon = {
    ...policy.daemon,
    idleExitMinutes: set.idleExitMinutes ? idle : defaults.idleExitMinutes,
    unusedExitMinutes: set.unusedExitMinutes ? unused : defaults.unusedExitMinutes,
    ...(set.idleExitMinutes || set.unusedExitMinutes ? { set } : {}),
  };
  return { ...policy, daemon };
}

/** Spec 026 D2.2: `daemon.unusedExitMinutes` with no test group at `edit` or `pause`. */
export const EDIT_FREE_UNUSED_EXIT_MINUTES = 2;

/**
 * Spec 026 D2.2 (row 026-09; the human, 2026-11-24): the exit bounds a
 * daemon keeps, which `squeal ps` shows. A bound the file sets wins. Unset,
 * with no test group at `edit` or `pause` (D1's deferred keying,
 * `keyingDeferred`), `daemon.unusedExitMinutes` is 2, and a daemon with no
 * consumer stops after the lesser of `daemon.idleExitMinutes` and it (the
 * coordinator, 2026-11-24): a hook that starts a daemon on a fresh store
 * registers no consumer (`startSession`), so it would idle for 60 minutes
 * between bursts. Otherwise both keep their values (001 D10). A policy not
 * from the loader, with no `set`, keeps any value but a default's.
 */
export function daemonExits(policy: Policy): DaemonExits {
  const { idleExitMinutes: idle, unusedExitMinutes: unused, set } = policy.daemon;
  const defaults = DEFAULT_POLICY.daemon;
  const derive = (key: keyof DaemonExits, value: number) =>
    set?.[key] !== true && value === defaults[key] && keyingDeferred(policy);
  const unusedExitMinutes = derive("unusedExitMinutes", unused)
    ? EDIT_FREE_UNUSED_EXIT_MINUTES
    : unused;
  const idleExitMinutes = derive("idleExitMinutes", idle)
    ? Math.min(idle, unusedExitMinutes)
    : idle;
  return { idleExitMinutes, unusedExitMinutes };
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
