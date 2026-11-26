import { readFileSync } from "node:fs";
import { isMissing } from "../fs/errors.js";
import { isRecord } from "../fs/json.js";

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
  /**
   * Row 011-275 (gh-120): the path of each key `shape` does not know, each
   * also a problem. No default stands in for one: it is not applied.
   * Absent when there is none.
   */
  readonly unknownKeys?: readonly string[];
}

export const positiveInteger: Leaf = (v) =>
  Number.isInteger(v) && (v as number) > 0 ? null : "a positive integer";

/**
 * Row 025-18: the last load of each file by each shape, with the text it was
 * loaded from. One Stop loads `squeal.config.json` seven times and one
 * SessionStart nine (`research/hook-runtime.md`, "Runtime work"); a load of
 * unchanged text returns the earlier result in place of parsing and merging
 * again. The file is still read every time, so an edit is seen by the next
 * load in every process, a long-lived one (the daemon, Pi's worker,
 * OpenCode's bridge) included. Results are shared: `LoadedConfig` is read-only.
 */
const lastLoads = new WeakMap<Shape, Map<string, LastLoad>>();
interface LastLoad {
  /** The file's text, `null` when it was missing. */
  readonly text: string | null;
  readonly defaults: object;
  readonly loaded: LoadedConfig<object>;
}

/**
 * Reads the JSON file at `path` and applies it over `defaults` by `shape`.
 * A missing file is the defaults with no problems. A file that cannot be
 * read, is not JSON or is not an object is the defaults with one problem.
 * The same text with the same `shape` and `defaults` gives the same result
 * object (`lastLoads`).
 */
export function loadConfigFile<T extends object>(
  path: string,
  shape: Shape,
  defaults: T,
): LoadedConfig<T> {
  let text: string | null;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (!isMissing(error)) {
      return { value: defaults, problems: [`could not be read: ${String(error)}`], unparsed: true };
    }
    text = null;
  }
  let byPath = lastLoads.get(shape);
  const last = byPath?.get(path);
  if (last !== undefined && last.text === text && last.defaults === defaults) {
    return last.loaded as LoadedConfig<T>;
  }
  const loaded = text === null ? { value: defaults, problems: [] } : parse(text, shape, defaults);
  if (byPath === undefined) lastLoads.set(shape, (byPath = new Map()));
  byPath.set(path, { text, defaults, loaded });
  return loaded;
}

function parse<T extends object>(text: string, shape: Shape, defaults: T): LoadedConfig<T> {
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
  const unknownKeys: string[] = [];
  const merged = merge(shape, defaults, parsed, "", { problems, unknownKeys });
  return {
    value: merged as unknown as T,
    problems,
    ...(unknownKeys.length === 0 ? {} : { unknownKeys }),
  };
}

/** What `merge` found wrong: every problem, and the unknown keys among them by path. */
interface Found {
  readonly problems: string[];
  readonly unknownKeys: string[];
}

function merge(
  shape: Shape,
  defaults: object,
  given: Record<string, unknown>,
  prefix: string,
  found: Found,
): Record<string, unknown> {
  const { problems } = found;
  const result: Record<string, unknown> = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    const path = `${prefix}${key}`;
    const rule = Object.hasOwn(shape, key) ? shape[key] : undefined;
    if (rule === undefined) {
      problems.push(unknownKey(path));
      found.unknownKeys.push(path);
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
      result[key] = merge(rule, nested, value, `${path}.`, found);
    }
  }
  return result;
}

/** The problem the loader reports for a key at `path` it does not know. */
export function unknownKey(path: string): string {
  return `unknown key "${path}"`;
}

/** Problems for a note, with what follows from them. */
export function describeProblems(problems: readonly string[]): string {
  return `${problems.join("; ")}; the defaults apply in their place`;
}
