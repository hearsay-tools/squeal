import { readFileSync } from "node:fs";
import { extname, join } from "node:path";
import {
  CODE_EXTENSIONS,
  type CodeLanguage,
  type FunctionCount,
} from "../../../src/core/types/code.js";

/*
 * Spec 015 D3's reference counts, made by ESLint's and radon's own code
 * (`test/fixtures/code/README.md`). ESLint's are keyed by a function's end,
 * since it places an arrow at its `=>`; radon's by its start, the `def`.
 */

export const FIXTURES = join(import.meta.dirname, "../../fixtures/code");

/** Per file, `[line, column, cc]` of each function, 1-based as `CodeRange`. */
export interface Reference {
  readonly commit?: string;
  readonly files: Readonly<Record<string, readonly (readonly [number, number, number])[]>>;
}

export function readReference(name: string): Reference {
  return JSON.parse(readFileSync(join(FIXTURES, name), "utf8")) as Reference;
}

export function languageOf(path: string): CodeLanguage {
  const language = CODE_EXTENSIONS[extname(path)];
  if (language === undefined) throw new Error(`no code language for ${path}`);
  return language;
}

/** CCs by `line:column`, each list sorted: functions that end together share a key. */
export type Keyed = Map<string, number[]>;

export function keyed(functions: readonly FunctionCount[], at: "start" | "end"): Keyed {
  return group(
    functions.map((f) =>
      at === "start"
        ? [f.range.startLine, f.range.startColumn, f.complexity]
        : [f.range.endLine, f.range.endColumn, f.complexity],
    ),
  );
}

export function referenceKeyed(entries: readonly (readonly [number, number, number])[]): Keyed {
  return group(entries);
}

function group(entries: readonly (readonly [number, number, number])[]): Keyed {
  const out: Keyed = new Map();
  for (const [line, column, cc] of entries) {
    const key = `${line}:${column}`;
    out.set(
      key,
      [...(out.get(key) ?? []), cc].sort((a, b) => a - b),
    );
  }
  return new Map([...out].sort(([a], [b]) => a.localeCompare(b)));
}
