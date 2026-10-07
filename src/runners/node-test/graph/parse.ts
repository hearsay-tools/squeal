import { init, parse } from "es-module-lexer";
import { codeAt } from "./code-ranges.js";

/** The lexer compiles its WebAssembly once; await before {@link parseModule}. */
export const parserReady: Promise<void> = init();

/** One specifier of a module: an import, a `require`, or a template-literal `import()` glob. */
export interface ParsedSpecifier {
  readonly specifier: string;
  readonly kind: "import" | "require" | "glob";
  /** An `import()`: tsx keeps it an ESM import even in a module it compiles to CommonJS. */
  readonly dynamic?: true;
}

export interface ParsedModule {
  readonly specifiers: readonly ParsedSpecifier[];
  /**
   * Why the static closure through this module is incomplete: a computed
   * `import(p)`, or a source the lexer rejects, with its location (D3).
   */
  readonly incomplete: readonly string[];
}

/** Modules the lexer reads; anything else (JSON, text) is a leaf. */
export const PARSED_EXTENSION = /\.(?:[mc]?[jt]s|[jt]sx)$/;

/** A literal `require("x")`; `myrequire(` and `require(x)` do not match. */
const REQUIRE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
/** Any call of `require`, literal or not; `x.require(` and `myrequire(` do not match. */
const REQUIRE_CALL = /(?<![\w$.])require\s*\(/g;

/**
 * Specifiers of one module (spec 003 D3): es-module-lexer for `import`,
 * `export ... from` and `import()`, dropping type-only records, plus a scan
 * for literal `require(...)`. `name` is the module's worktree-relative path,
 * used in the reasons.
 */
export function parseModule(source: string, name: string): ParsedModule {
  const specifiers: ParsedSpecifier[] = [];
  const incomplete: string[] = [];
  try {
    const [imports] = parse(source, name);
    for (const record of imports) {
      if (record.type === "import-meta") continue;
      if (record.type === "dynamic") {
        if (record.probablyTypeOnly) continue;
        if (record.specifier === undefined) {
          incomplete.push(
            `import() with a computed specifier at ${name}:${position(source, record.importStart)}`,
          );
          continue;
        }
        specifiers.push(
          record.glob
            ? { specifier: record.specifier, kind: "glob" }
            : { specifier: record.specifier, kind: "import", dynamic: true },
        );
        continue;
      }
      if (!record.typeOnly) specifiers.push({ specifier: record.specifier, kind: "import" });
    }
  } catch (error) {
    incomplete.push(`${name} does not parse as a module: ${(error as Error).message}`);
  }
  const literal = new Set<number>();
  for (const match of source.matchAll(REQUIRE)) {
    if (match[2] !== undefined) specifiers.push({ specifier: match[2], kind: "require" });
    literal.add(match.index);
  }
  // N6: a computed `require(x)` hides its target as a computed `import(p)` does.
  // Wave 2 N3: in code only; a literal `require` in a comment above stays a specifier,
  // since a closure one path too wide only costs a re-run.
  let code: ((offset: number) => boolean) | null = null;
  for (const match of source.matchAll(REQUIRE_CALL)) {
    if (literal.has(match.index)) continue;
    code ??= codeAt(source);
    if (code(match.index)) {
      incomplete.push(
        `require() with a computed specifier at ${name}:${position(source, match.index)}`,
      );
    }
  }
  return { specifiers, incomplete };
}

/** 1-based `line:column` of an offset. */
function position(source: string, offset: number): string {
  let line = 1;
  let start = 0;
  for (let i = source.indexOf("\n"); i !== -1 && i < offset; i = source.indexOf("\n", i + 1)) {
    line++;
    start = i + 1;
  }
  return `${line}:${offset - start + 1}`;
}
