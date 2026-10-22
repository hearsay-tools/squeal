import { readFileSync } from "node:fs";
import { isMissing, isRecord } from "../fs/index.js";

/**
 * Spec 001 D11's loader rules, shared by `squeal.config.json` and the
 * user-level `config.json` of the Capacity paragraph: never throws; unknown
 * keys and wrong types are problems and the defaults apply for those keys.
 */

/**
 * Checks one leaf value; returns what was expected when the value does not
 * fit, a whole `problem` when the value has the right type but cannot be
 * used, or the part of a value it keeps with one problem per dropped entry.
 */
export type Leaf = (value: unknown) => string | { readonly problem: string } | Kept | null;
/** What a leaf keeps of its value, and why it dropped the rest. */
export interface Kept {
  readonly kept: unknown;
  readonly problems: readonly string[];
}
export interface Shape {
  readonly [key: string]: Leaf | Shape;
}

export interface LoadedConfig<T> {
  readonly value: T;
  readonly problems: readonly string[];
  /** The file exists and cannot be read, is not JSON or is not an object: `value` is the defaults. */
  readonly unparsed?: true;
}

export const positiveInteger: Leaf = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : "a positive integer";

/**
 * Reads the JSON file at `path` and applies it over `defaults` by `shape`.
 * A missing file is the defaults with no problems. A file that cannot be
 * read, is not JSON or is not an object is the defaults with one problem.
 */
export function loadConfigFile<T extends object>(
  path: string,
  shape: Shape,
  defaults: T,
): LoadedConfig<T> {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (isMissing(error)) return { value: defaults, problems: [] };
    return { value: defaults, problems: [`could not be read: ${String(error)}`], unparsed: true };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const problem = `not valid JSON (${(error as Error).message})`;
    return { value: defaults, problems: [problem], unparsed: true };
  }
  if (!isRecord(parsed)) {
    const got = Array.isArray(parsed) ? "an array" : JSON.stringify(parsed);
    return { value: defaults, problems: [`must be a JSON object, got ${got}`], unparsed: true };
  }
  const problems: string[] = [];
  const merged = merge(shape, defaults, parsed, "", problems);
  return { value: merged as unknown as T, problems };
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
      else if (typeof expected === "object" && "kept" in expected) {
        result[key] = expected.kept;
        problems.push(...expected.problems);
      } else if (typeof expected === "object") problems.push(`"${path}" ${expected.problem}`);
      else problems.push(`"${path}" must be ${expected}, got ${JSON.stringify(value)}`);
    } else if (!isRecord(value)) {
      problems.push(`"${path}" must be an object, got ${JSON.stringify(value)}`);
    } else {
      const nested = (defaults as Record<string, object>)[key] ?? {};
      result[key] = merge(rule, nested, value, `${path}.`, problems);
    }
  }
  return result;
}

/** Problems for a note, with what follows from them. */
export function describeProblems(problems: readonly string[]): string {
  return `${problems.join("; ")}; the defaults apply in their place`;
}
