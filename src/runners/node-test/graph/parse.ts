import { init, parse, type StaticImport } from "es-module-lexer";
import { codeAt } from "./code-ranges.js";
import { droppedImports, ELIDING_EXTENSION } from "./type-imports.js";

/** The lexer compiles its WebAssembly once; await before {@link parseModule}. */
export const parserReady: Promise<void> = init();

/**
 * One specifier of a module: an import, a `require`, a template-literal
 * `import()` glob, or a builtin `process.getBuiltinModule` loads, as `node:<name>`.
 */
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
  /**
   * The module loads something no specifier names (task 003-22, spec 001 D3
   * case 2): a computed `import()` or `require()`, `require.resolve` but of
   * one relative literal, `import.meta.resolve`, `createRequire`, a computed
   * `process.getBuiltinModule` (task 003-33), or a source the lexer
   * rejects. It can reach any installed package.
   */
  readonly unnamed: boolean;
  /**
   * Row 018-62, b2: an import was left out because esbuild drops it, which
   * the tsconfig decides, so the tsconfig keys the module.
   */
  readonly elided?: true;
}

/** Modules the lexer reads; anything else (JSON, text) is a leaf. */
export const PARSED_EXTENSION = /\.(?:[mc]?[jt]s|[jt]sx)$/;

/** A literal `require("x")`; `myrequire(` and `require(x)` do not match. */
const REQUIRE = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;
/** Any call of `require`, literal or not; `x.require(` and `myrequire(` do not match. */
const REQUIRE_CALL = /(?<![\w$.])require\s*\(/g;
/**
 * A resolution by hand: `require.resolve` but of one relative string literal,
 * which names a file as Vitest's scan has it (review wave-11d S3),
 * `import.meta.resolve`, and `createRequire` however `module` was reached,
 * as Vitest's scan has it (review wave-3 B2: through `process.getBuiltinModule`).
 */
const RESOLVE =
  /(?<![\w$.])require\s*\.\s*resolve\b(?!\s*\(\s*(["'])\.\.?\/[^"'\n]*\1\s*\))|\bimport\s*\.\s*meta\s*\.\s*resolve\b|\bcreateRequire\b/g;
/** `process.getBuiltinModule(...)`, with its argument when that is one string literal. */
const GET_BUILTIN = /\bgetBuiltinModule\s*\(\s*(?:(["'])([^"'\n]+)\1\s*\))?/g;

export interface ParseOptions {
  /**
   * Row 018-62, b2: tsx compiles this TypeScript module with esbuild, and
   * the tsconfig keeps no unused value import, so an import whose bindings
   * are used only as types never loads.
   */
  readonly elideTypeImports?: boolean;
}

/**
 * Specifiers of one module (spec 003 D3): es-module-lexer for `import`,
 * `export ... from` and `import()`, dropping type-only records and, under
 * `elideTypeImports`, the imports esbuild drops, plus a scan for literal
 * `require(...)` in code. `name` is the module's worktree-relative path,
 * used in the reasons and to tell TypeScript.
 */
export function parseModule(
  source: string,
  name: string,
  options: ParseOptions = {},
): ParsedModule {
  const lexed = lexImports(source, name, options);
  const { specifiers, incomplete, elided } = lexed;
  let unnamed = lexed.unnamed;
  const literal = new Set<number>();
  let code: ((offset: number) => boolean) | null = null;
  // Row 018-62, b3: in code only. A `require('./x')` in a string or a comment
  // loads nothing, and under D9 the absent candidates it adds leave the file out.
  for (const match of source.matchAll(REQUIRE)) {
    literal.add(match.index);
    code ??= codeAt(source);
    if (match[2] !== undefined && code(match.index)) {
      specifiers.push({ specifier: match[2], kind: "require" });
    }
  }
  // N6: a computed `require(x)` hides its target as a computed `import(p)` does.
  // Wave 2 N3: in code only.
  for (const match of source.matchAll(REQUIRE_CALL)) {
    if (literal.has(match.index)) continue;
    code ??= codeAt(source);
    if (code(match.index)) {
      incomplete.push(
        `require() with a computed specifier at ${name}:${position(source, match.index)}`,
      );
      unnamed = true;
    }
  }
  // Review wave-3 B2: a builtin loaded by name, which no import names; a computed one may be `module`.
  for (const match of source.matchAll(GET_BUILTIN)) {
    code ??= codeAt(source);
    if (!code(match.index)) continue;
    const name = match[2];
    if (name === undefined) unnamed = true;
    else
      specifiers.push({
        specifier: name.startsWith("node:") ? name : `node:${name}`,
        kind: "require",
      });
  }
  for (const match of source.matchAll(RESOLVE)) {
    if (unnamed) break;
    code ??= codeAt(source);
    unnamed = code(match.index);
  }
  return { specifiers, incomplete, unnamed, ...(elided ? { elided: true as const } : {}) };
}

/** es-module-lexer's records of one module, as {@link parseModule}'s first part. */
function lexImports(
  source: string,
  name: string,
  options: ParseOptions,
): { specifiers: ParsedSpecifier[]; incomplete: string[]; unnamed: boolean; elided: boolean } {
  const specifiers: ParsedSpecifier[] = [];
  const incomplete: string[] = [];
  let unnamed = false;
  let elided = false;
  try {
    const [imports] = parse(source, name);
    const statics = imports.filter((r): r is StaticImport => r.type === "static");
    const dropped =
      options.elideTypeImports === true && ELIDING_EXTENSION.test(name)
        ? droppedImports(source, statics)
        : new Set<StaticImport>();
    elided = dropped.size > 0;
    for (const record of imports) {
      if (record.type === "import-meta") continue;
      if (record.type !== "dynamic") {
        if (!record.typeOnly && !dropped.has(record)) {
          specifiers.push({ specifier: record.specifier, kind: "import" });
        }
      } else if (record.probablyTypeOnly) {
      } else if (record.specifier === undefined) {
        incomplete.push(
          `import() with a computed specifier at ${name}:${position(source, record.importStart)}`,
        );
        unnamed = true;
      } else {
        specifiers.push(
          record.glob
            ? { specifier: record.specifier, kind: "glob" }
            : { specifier: record.specifier, kind: "import", dynamic: true },
        );
      }
    }
  } catch (error) {
    incomplete.push(`${name} does not parse as a module: ${(error as Error).message}`);
    unnamed = true;
  }
  return { specifiers, incomplete, unnamed, elided };
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
