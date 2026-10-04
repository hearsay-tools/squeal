import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isMissing } from "../fs/index.js";
import {
  DEFAULT_POLICY,
  type LoadedPolicy,
  notesMetaKey,
  type Policy,
  type Store,
  type WorktreeId,
} from "../types/index.js";

/** Spec 001 D11: "`squeal.config.json` at the repository root, committed, all keys optional". */
export const POLICY_FILE = "squeal.config.json";

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
 * `DEFAULT_POLICY`. The one loader of daemon and hooks; never throws.
 *
 * Spec 001 D11: "unknown keys and wrong types are reported as problems, the
 * defaults apply for those keys". A missing file is the defaults with no
 * problems. A file that cannot be read, is not JSON or is not an object is
 * the defaults with one problem.
 */
export function loadPolicy(root: string): LoadedPolicy {
  let text: string;
  try {
    text = readFileSync(join(root, POLICY_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return { policy: DEFAULT_POLICY, problems: [] };
    return defaultsBecause(`could not be read: ${String(error)}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return defaultsBecause(`not valid JSON (${(error as Error).message})`);
  }
  if (!isObject(parsed)) {
    return defaultsBecause(
      `must be a JSON object, got ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}`,
    );
  }
  const problems: string[] = [];
  const merged = merge(SHAPE, DEFAULT_POLICY, parsed, "", problems);
  return { policy: merged as unknown as Policy, problems };
}

/** The policy alone, for callers that act on it and leave reporting to the daemon (the hooks). */
export function readPolicy(root: string): Policy {
  return loadPolicy(root).policy;
}

function defaultsBecause(problem: string): LoadedPolicy {
  return { policy: DEFAULT_POLICY, problems: [problem] };
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

/** Problems for a note, with what follows from them. */
export function describeProblems(problems: readonly string[]): string {
  return `${problems.join("; ")}; the defaults apply in their place`;
}

/** Text of the newest persisted note about `squeal.config.json`, or `null`. */
export function lastPolicyNote(store: Store, worktreeId: WorktreeId): string | null {
  let notes: unknown;
  try {
    notes = JSON.parse(store.meta.get(notesMetaKey(worktreeId)) ?? "[]");
  } catch {
    // Notes that do not parse are replaced by the next note (`appendNote`).
    return null;
  }
  if (!Array.isArray(notes)) return null;
  const texts = notes.map((note) => (note as { text?: unknown }).text);
  const last = texts.findLast((text) => typeof text === "string" && text.startsWith(POLICY_FILE));
  return typeof last === "string" ? last : null;
}
