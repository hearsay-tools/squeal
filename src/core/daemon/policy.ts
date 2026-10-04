import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../fs/index.js";
import { type AbsolutePath, DEFAULT_POLICY, type Policy } from "../types/index.js";

/** Spec 001 D11: "`squeal.config.json` at the repository root, committed, all keys optional". */
export const POLICY_FILE = "squeal.config.json";

/** `squeal.config.json` has keys that are unknown or values of the wrong type. Lists every problem. */
export class PolicyError extends Error {
  override readonly name = "PolicyError";
  constructor(
    readonly path: AbsolutePath,
    readonly problems: readonly string[],
  ) {
    super(`${path}: ${problems.join("; ")}`);
  }
}

/** Checks one leaf value; returns what was expected when the value does not fit. */
type Leaf = (value: unknown) => string | null;
interface Shape {
  readonly [key: string]: Leaf | Shape;
}

const boolean: Leaf = (v) => (typeof v === "boolean" ? null : "true or false");
const strings: Leaf = (v) =>
  Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
const atLeastZero: Leaf = (v) => (isNumber(v) && v >= 0 ? null : "a number >= 0");
const aboveZero: Leaf = (v) => (isNumber(v) && v > 0 ? null : "a number > 0");
const positiveInteger: Leaf = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : "a positive integer";
const orNull =
  (leaf: Leaf): Leaf =>
  (v) => {
    const expected = v === null ? null : leaf(v);
    return expected === null ? null : `${expected}, or null`;
  };
const oneOf =
  (...values: readonly string[]): Leaf =>
  (v) =>
    values.includes(v as string) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;

/** Every key of `Policy`, mirroring `DEFAULT_POLICY`. */
const SHAPE: Shape = {
  interrupt: { onRegression: boolean },
  stop: { blockOnKnownFailures: boolean, requireFullSuite: boolean, waitMs: atLeastZero },
  baseline: { onStart: oneOf("lookup-then-run-missing", "lookup-only") },
  inputs: strings,
  env: { allowlist: strings },
  runner: {
    tierSize: positiveInteger,
    timeoutMs: orNull(positiveInteger),
    maxConcurrentRuns: positiveInteger,
  },
  daemon: { idleExitMinutes: aboveZero },
  store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) },
};

/**
 * Reads `squeal.config.json` from the worktree root and applies it over
 * `DEFAULT_POLICY` (spec 001 D11). A missing file is the defaults. Throws a
 * `PolicyError` naming every unknown key and every value of the wrong type,
 * so a typo never silently falls back to a default.
 */
export function loadPolicy(root: AbsolutePath): Policy {
  const path = join(root, POLICY_FILE);
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return DEFAULT_POLICY;
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new PolicyError(path, [`not valid JSON (${(error as Error).message})`]);
  }
  if (!isObject(parsed)) throw new PolicyError(path, ["must be a JSON object"]);
  const problems: string[] = [];
  const merged = merge(SHAPE, DEFAULT_POLICY, parsed, "", problems);
  if (problems.length > 0) throw new PolicyError(path, problems);
  return merged as unknown as Policy;
}

function merge(
  shape: Shape,
  defaults: object,
  given: Record<string, unknown>,
  prefix: string,
  problems: string[],
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    const path = `${prefix}${key}`;
    const rule = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (rule === undefined) {
      problems.push(`unknown key "${path}"`);
    } else if (typeof rule === "function") {
      const expected = rule(value);
      if (expected === null) result[key] = value;
      else problems.push(`"${path}" must be ${expected}, got ${JSON.stringify(value)}`);
    } else if (!isObject(value)) {
      problems.push(`"${path}" must be an object, got ${JSON.stringify(value)}`);
    } else {
      const nested = (defaults as Record<string, object>)[key] ?? {};
      result[key] = merge(rule, nested, value, `${path}.`, problems);
    }
  }
  return result;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
