import { isAbsolute, posix } from "node:path";
import { isRecord } from "../fs/json.js";
import type { PytestProject, SlotPolicy } from "../types/policy.js";
import {
  boolean,
  type EntryCheck,
  type Field,
  globs,
  insideRoot,
  nonEmptyString,
  type ProjectEntries,
  projectEntries,
  strings,
  variables,
} from "./policy-node-test.js";

/** Every key of `PytestProject`; `name` and `include` are required. */
const FIELDS: Readonly<Record<keyof PytestProject, Field>> = {
  name: nonEmptyString,
  cwd: insideRoot,
  python: nonEmptyString,
  args: strings,
  env: variables,
  include: globs,
  exclude: globs,
  slow: boolean,
  batchSize: positiveInteger,
  slots,
};
const REQUIRED: ReadonlySet<string> = new Set(["name", "include"]);

/** D6: files per pytest process; absent means the adapter's default of 5. */
function positiveInteger(value: unknown): string | null {
  return Number.isInteger(value) && (value as number) > 0 ? null : "a positive integer";
}

/** Every key of `SlotPolicy`. */
const SLOT_FIELDS: Readonly<Record<keyof SlotPolicy, Field>> = {
  toxParallelEnv: boolean,
  max: positiveInteger,
};

/** Spec 027 D2.3: `slots.toxParallelEnv` a boolean, `slots.max` a positive integer, no other key. */
function slots(value: unknown): string | { readonly problem: string } | null {
  if (!isRecord(value)) return "an object with toxParallelEnv and max";
  for (const key of Object.keys(value)) {
    if (!Object.hasOwn(SLOT_FIELDS, key)) return { problem: `has an unknown key "${key}"` };
  }
  for (const [key, field] of Object.entries(SLOT_FIELDS)) {
    const given = value[key];
    if (given === undefined) continue;
    const expected = field(given);
    if (expected !== null) {
      return { problem: `key "${key}" must be ${String(expected)}, got ${JSON.stringify(given)}` };
    }
  }
  return null;
}

/**
 * The `pytest` rule of the policy loader (spec 007 D1), with 003 D1's entry
 * rules. `args` defaults to `[]` and `env` to `{}`.
 */
export function pytestProjects(value: unknown, path: string): ProjectEntries<PytestProject> {
  return projectEntries(value, path, FIELDS, REQUIRED, withDefaults, pythonInsideRoot);
}

function withDefaults(entry: Partial<PytestProject>): PytestProject {
  return { ...entry, args: entry.args ?? [], env: entry.env ?? {} } as PytestProject;
}

/**
 * D1, D2: a relative `python` resolves from `cwd` and must stay inside the
 * worktree, since discovery never looks above its root; an absolute path
 * declares an environment outside it.
 */
const pythonInsideRoot: EntryCheck = (entry) => {
  const python = entry.python as string | undefined;
  if (python === undefined || isAbsolute(python)) return null;
  const path = posix.join((entry.cwd as string | undefined) ?? ".", python.replaceAll("\\", "/"));
  if (insideRoot(path) === null) return null;
  return {
    key: "python",
    problem: `must stay inside the worktree when relative (absolute only for an environment outside it), got ${JSON.stringify(python)}`,
  };
};
