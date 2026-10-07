import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import {
  type AnyNode,
  type CallExpression,
  type Expression,
  type Program,
  parse,
  type SpreadElement,
  type Super,
} from "acorn";
import type { AbsolutePath, EnumeratedCheck, TestFileRef } from "../../core/types/index.js";

/**
 * Static enumeration of one node:test file (spec 003 D6): the checks it
 * declares, named as a run names them (D2), before it has ever run.
 *
 * Spec 003 D6: "`enumerate(testFile)` strips TypeScript with
 * `module.stripTypeScriptTypes` [...], parses the result with acorn [...] and
 * walks calls to `test`, `it`, `describe`, `suite` and `t.test` with a literal
 * first argument, building full names from the call nesting; a call with a
 * non-literal name is one `templated` entry; a file that does not strip
 * (enums, namespaces, parameter properties) enumerates nothing until it has
 * run."
 */
export async function enumerate(
  file: AbsolutePath,
  testFile: TestFileRef,
): Promise<EnumeratedCheck[]> {
  return enumerateSource(await readFile(file, "utf8"), testFile);
}

/** `enumerate` over a file's source text. */
export function enumerateSource(source: string, testFile: TestFileRef): EnumeratedCheck[] {
  const program = parseStripped(source);
  if (!program) return [];
  const found: Found[] = [];
  const bindings = nodeTestBindings(program);
  visit(program, { prefix: [], context: null }, bindings, source, found);
  return suffixDuplicates(found).map((entry) => ({
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: entry.fullName,
    },
    templated: entry.templated,
    location: { path: testFile.path, line: entry.line, column: entry.column },
  }));
}

type Kind = "test" | "suite";

interface Found {
  readonly fullName: string;
  readonly templated: boolean;
  readonly line: number;
  readonly column: number;
}

interface Scope {
  /** Names of the enclosing suites and tests, outermost first. */
  readonly prefix: readonly string[];
  /** First parameter of the enclosing test or suite callback, whose `.test` declares a subtest. */
  readonly context: string | null;
}

/** Local names bound to node:test's functions: direct calls and namespaces. */
interface Bindings {
  readonly calls: ReadonlyMap<string, Kind>;
  readonly namespaces: ReadonlySet<string>;
}

const KINDS: ReadonlyMap<string, Kind> = new Map([
  ["test", "test"],
  ["it", "test"],
  ["describe", "suite"],
  ["suite", "suite"],
]);
const MODIFIERS = new Set(["skip", "todo", "only"]);
const NODE_TEST = new Set(["node:test", "test"]);

/**
 * Strip mode replaces types by whitespace, so acorn's positions are the
 * original lines and columns, the ones `--enable-source-maps` gives a run.
 */
function parseStripped(source: string): Program | null {
  let code: string;
  try {
    code = stripTypeScriptTypes(source, { mode: "strip" });
  } catch {
    return null;
  }
  for (const sourceType of ["module", "script"] as const) {
    try {
      return parse(code, {
        ecmaVersion: "latest",
        sourceType,
        locations: true,
        allowHashBang: true,
      });
    } catch {
      // A CommonJS file can fail as a module (`with`, legacy octal); try it as a script.
    }
  }
  return null;
}

/** The bare names plus every alias, default and namespace import of node:test. */
function nodeTestBindings(program: Program): Bindings {
  const calls = new Map(KINDS);
  const namespaces = new Set<string>();
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || !NODE_TEST.has(String(statement.source.value)))
      continue;
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportDefaultSpecifier") calls.set(specifier.local.name, "test");
      else if (specifier.type === "ImportNamespaceSpecifier") namespaces.add(specifier.local.name);
      else {
        const imported =
          specifier.imported.type === "Identifier"
            ? specifier.imported.name
            : specifier.imported.value;
        const kind = KINDS.get(String(imported));
        if (kind) calls.set(specifier.local.name, kind);
      }
    }
  }
  return { calls, namespaces };
}

function visit(
  node: AnyNode,
  scope: Scope,
  bindings: Bindings,
  source: string,
  found: Found[],
): void {
  const kind = node.type === "CallExpression" ? classify(node.callee, scope, bindings) : null;
  if (node.type === "CallExpression" && kind) {
    declare(node, kind, scope, bindings, source, found);
    return;
  }
  for (const key of Object.keys(node)) {
    const value = (node as unknown as Record<string, unknown>)[key];
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child, scope, bindings, source, found);
    } else if (isNode(value)) visit(value, scope, bindings, source, found);
  }
}

/** One test or suite call: an entry for a test, then its callback under the new prefix. */
function declare(
  call: CallExpression,
  kind: Kind,
  scope: Scope,
  bindings: Bindings,
  source: string,
  found: Found[],
): void {
  // `locations: true` sets `loc`; acorn columns are 0-based, a run's are 1-based.
  const start = call.loc?.start ?? { line: 0, column: -1 };
  const position = { line: start.line, column: start.column + 1 };
  const first = call.arguments[0];
  const name = first ? literalName(first) : null;
  if (name === null) {
    // A non-literal name: one templated entry, its children unknown until the file runs.
    const template = first ? source.slice(first.start, first.end) : "<anonymous>";
    found.push({ fullName: [...scope.prefix, template].join(" > "), templated: true, ...position });
    return;
  }
  const prefix = [...scope.prefix, name];
  if (kind === "test") found.push({ fullName: prefix.join(" > "), templated: false, ...position });
  const callback = call.arguments.findLast(
    (arg) => arg.type === "ArrowFunctionExpression" || arg.type === "FunctionExpression",
  );
  if (
    !callback ||
    (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression")
  )
    return;
  const param = callback.params[0];
  const context = param?.type === "Identifier" ? param.name : null;
  visit(callback.body, { prefix, context }, bindings, source, found);
}

function classify(callee: Expression | Super, scope: Scope, bindings: Bindings): Kind | null {
  if (callee.type === "Identifier") return bindings.calls.get(callee.name) ?? null;
  if (callee.type !== "MemberExpression") return null;
  const member = callee;
  if (member.computed || member.property.type !== "Identifier") return null;
  const property = member.property.name;
  if (MODIFIERS.has(property)) return classify(member.object, scope, bindings);
  if (member.object.type !== "Identifier") return null;
  if (property === "test" && member.object.name === scope.context) return "test";
  if (bindings.namespaces.has(member.object.name)) return KINDS.get(property) ?? null;
  return null;
}

/** A string literal or a template literal without substitutions; anything else is non-literal. */
function literalName(arg: Expression | SpreadElement): string | null {
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "TemplateLiteral" && arg.expressions.length === 0)
    return arg.quasis[0]?.value.cooked ?? null;
  return null;
}

/**
 * Spec 001 D4 and 003 D2: the second and later declarations sharing a full
 * name carry their line, then an ordinal on one line: `name (line 5)`,
 * `name (line 5, 2)`, as `checkNames` in `src/runners/vitest/results.ts`.
 * Local until 003-16 replaces it by `identity.ts`.
 */
function suffixDuplicates(found: readonly Found[]): Found[] {
  const used = new Set<string>();
  return found.map((entry) => {
    const { fullName, line } = entry;
    let name = fullName;
    if (used.has(name)) {
      name = `${fullName} (line ${line})`;
      for (let n = 2; used.has(name); n++) name = `${fullName} (line ${line}, ${n})`;
    }
    used.add(name);
    return { ...entry, fullName: name };
  });
}

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
