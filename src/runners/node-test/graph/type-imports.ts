import * as nodeModule from "node:module";
import type { StaticImport } from "es-module-lexer";
import { codeAt } from "./code-ranges.js";

/** The TypeScript sources tsx compiles with esbuild; `.tsx` keeps its imports (a JSX factory may use one). */
export const ELIDING_EXTENSION = /\.[mc]?ts$/;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/**
 * Row 018-62, b2: the static imports of a TypeScript module that tsx's
 * esbuild drops. Without `verbatimModuleSyntax`, `preserveValueImports` or
 * `importsNotUsedAsValues` keeping them, esbuild removes an import none of
 * whose bindings the emitted JavaScript names: one used only as a type, or
 * not at all. Each binding is looked for in Node's own type stripping of the
 * source, outside the import statements, in code only. Sound rather than
 * complete: any doubt (an import with no binding, a binding seen as a
 * property name or shadowed, a source Node cannot strip) keeps the import,
 * since a module dropped here and loaded by Node would leave the key short.
 */
export function droppedImports(
  source: string,
  imports: readonly StaticImport[],
): Set<StaticImport> {
  const candidates = imports
    .map((record) => ({ record, names: bindingsOf(source, record) }))
    .filter((c): c is { record: StaticImport; names: string[] } => c.names !== null);
  const dropped = new Set<StaticImport>();
  if (candidates.length === 0) return dropped;
  const statements = imports.map((r) => [r.importStart, r.importEnd] as const);
  const outside = (offset: number) => !statements.some(([s, e]) => offset >= s && offset < e);
  // The source as written, comments and strings too: a name it never holds is unused.
  const written = referencesIn(source, outside, false);
  // A name plainly used as a value keeps its import without stripping, which
  // loads Node's TypeScript parser (about 16 MiB) only when it can decide.
  const open = candidates.filter(
    (c) => !c.names.some((n) => written.has(n) && valueUse(source, n, outside)),
  );
  let stripped: Set<string> | null = null;
  if (open.some((c) => c.names.some((n) => written.has(n)))) {
    const text = strip(source);
    // Stripping blanks types in place, so offsets keep their meaning.
    if (text !== null) stripped = referencesIn(text, outside, true);
  }
  for (const { record, names } of open) {
    const seen = names.some((n) => written.has(n)) ? stripped : written;
    if (seen !== null && !names.some((n) => seen.has(n))) dropped.add(record);
  }
  return dropped;
}

/**
 * The local names a static `import ... from` binds, inline `type` names
 * left out; `null` for a statement this does not read with certainty: a
 * re-export, a side-effect import, `import x = require()`, a phase import.
 */
function bindingsOf(source: string, record: StaticImport): string[] | null {
  if (record.typeOnly || record.phase !== null || record.type !== "static") return null;
  const head = source.slice(record.importStart, record.start - 1);
  const clause = /^import\s+([\s\S]*?)\s*from\s*$/.exec(head)?.[1];
  if (clause === undefined || /\/[/*]/.test(clause)) return null;
  const braces = /\{([\s\S]*)\}/.exec(clause);
  const outer = braces === null ? clause : clause.replace(braces[0], "");
  const names = [
    ...outer.split(",").map((part) => locals(part, /^\*\s*as\s+(\S+)$/)),
    ...(braces?.[1] ?? "").split(",").map((part) => locals(part, /\sas\s+(\S+)$/)),
  ];
  return names.includes(null) ? null : names.flatMap((n) => n ?? []);
}

/** The local name one comma-separated part binds: `[]` for none or an inline `type`, `null` when unread. */
function locals(written: string, renamed: RegExp): string[] | null {
  const part = written.trim();
  if (part === "" || /^type\s+\S/.test(part)) return [];
  const local = renamed.exec(part)?.[1] ?? part;
  return IDENTIFIER.test(local) ? [local] : null;
}

/**
 * Every identifier `text` names outside the import statements, in code only
 * when `codeOnly` (JavaScript, which `codeAt` reads). A name after `.` is a
 * property, not the binding, unless the dot ends `...`.
 */
function referencesIn(
  text: string,
  outside: (offset: number) => boolean,
  codeOnly: boolean,
): Set<string> {
  const code = codeOnly ? codeAt(text) : () => true;
  const names = new Set<string>();
  for (const match of text.matchAll(/(?<![\w$])[A-Za-z_$][\w$]*/g)) {
    const at = match.index;
    if (text[at - 1] === "." && text.slice(at - 3, at) !== "...") continue;
    if (outside(at) && code(at)) names.add(match[0]);
  }
  return names;
}

/**
 * `name` is called, constructed, thrown, returned or awaited somewhere, which
 * no type does. A wrong yes (in a comment, a string) only keeps an import.
 */
function valueUse(source: string, name: string, outside: (offset: number) => boolean): boolean {
  const word = name.replaceAll("$", "\\$");
  const value = new RegExp(
    `(?<![\\w$.])${word}(?:\\s*\\.\\s*[A-Za-z_$][\\w$]*)*\\s*(?:\\?\\.\\s*)?[(\x60]|\\b(?:new|throw|return|await|yield|instanceof)\\s+${word}(?![\\w$])`,
    "g",
  );
  for (const match of source.matchAll(value)) if (outside(match.index)) return true;
  return false;
}

/** Node's type stripping (22.13 and later), or `null` when it is missing or rejects the source. */
function strip(source: string): string | null {
  const stripTypes = (nodeModule as { stripTypeScriptTypes?: (code: string) => string })
    .stripTypeScriptTypes;
  if (stripTypes === undefined) return null;
  try {
    return stripTypes(source);
  } catch {
    return null;
  }
}
