import { readFile } from "node:fs/promises";
import { stripTypeScriptTypes } from "node:module";
import { type AnyNode, type CallExpression, type Expression, parse, type Super } from "acorn";
import type { AbsolutePath } from "../../core/types/common.js";
import type { TestFileRef } from "../../core/types/keys.js";
import type { EnumeratedCheck } from "../../core/types/runner.js";
import { checkNames, NAME_SEPARATOR } from "./run/results.js";

/**
 * Static enumeration of one Jest file (spec 028 D6, as node:test's spec 003
 * D6): the checks it declares, named as a run names them (D5.2), before it
 * has ever run. TypeScript is stripped with `module.stripTypeScriptTypes`,
 * the rest parsed with acorn; calls to Jest's `test`, `it`, `describe` and
 * their `f`, `x`, `.skip`, `.only`, `.todo`, `.failing` and `.concurrent`
 * forms with a literal name build full names from the nesting. A skipped
 * suite's tests stay: Jest reports them skipped. A `.each` table or a
 * non-literal name is one `templated` entry. A file that does not parse
 * (JSX, enums) enumerates nothing until it has run.
 */
export async function enumerate(
  file: AbsolutePath,
  testFile: TestFileRef,
): Promise<EnumeratedCheck[]> {
  let source: string;
  try {
    source = await readFile(file, "utf8");
  } catch {
    return [];
  }
  return enumerateSource(source, testFile);
}

/** `enumerate` over a file's source text. */
export function enumerateSource(source: string, testFile: TestFileRef): EnumeratedCheck[] {
  const program = parseStripped(source);
  if (program === null) return [];
  const found: Found[] = [];
  visit(program, [], source, found);
  const names = checkNames(
    found.map((f) => ({ title: f.title, ancestorTitles: f.ancestors, location: f.location })),
  );
  return found.map((entry, i) => ({
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: entry.templated
        ? [...entry.ancestors, entry.title].join(NAME_SEPARATOR)
        : (names[i] as string),
    },
    templated: entry.templated,
    location: { path: testFile.path, ...entry.location },
  }));
}

interface Found {
  readonly ancestors: readonly string[];
  readonly title: string;
  readonly templated: boolean;
  readonly location: { readonly line: number; readonly column: number };
}

type Kind = "test" | "suite";

const KINDS: ReadonlyMap<string, Kind> = new Map([
  ["test", "test"],
  ["it", "test"],
  ["fit", "test"],
  ["xit", "test"],
  ["xtest", "test"],
  ["describe", "suite"],
  ["fdescribe", "suite"],
  ["xdescribe", "suite"],
]);
const MODIFIERS = new Set(["skip", "only", "todo", "failing", "concurrent"]);

function parseStripped(source: string): AnyNode | null {
  let code: string;
  try {
    code = quietly(() => stripTypeScriptTypes(source, { mode: "strip" }));
  } catch {
    return null;
  }
  for (const sourceType of ["module", "script"] as const) {
    try {
      return parse(code, { ecmaVersion: "latest", sourceType, locations: true });
    } catch {
      // A CommonJS file can fail as a module (`with`, legacy octal); try it as a script.
    }
  }
  return null;
}

/** Runs `strip` without its once-per-process `ExperimentalWarning` reaching the daemon's stderr. */
function quietly<T>(strip: () => T): T {
  const emit = process.emitWarning;
  process.emitWarning = function (this: NodeJS.Process, warning, ...rest: unknown[]) {
    const text = typeof warning === "string" ? warning : warning.message;
    if (text.includes("stripTypeScriptTypes")) return;
    return Reflect.apply(emit, this, [warning, ...rest]);
  } as typeof process.emitWarning;
  try {
    return strip();
  } finally {
    process.emitWarning = emit;
  }
}

function visit(node: AnyNode, ancestors: readonly string[], source: string, found: Found[]): void {
  if (node.type === "CallExpression") {
    const call = classify(node);
    if (call !== null) {
      declare(node, call, ancestors, source, found);
      return;
    }
  }
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) if (isNode(child)) visit(child, ancestors, source, found);
    } else if (isNode(value)) visit(value, ancestors, source, found);
  }
}

interface Classified {
  readonly kind: Kind;
  /** `test.each(table)(name, fn)`: one templated entry. */
  readonly each: boolean;
}

function classify(call: CallExpression): Classified | null {
  const { callee } = call;
  if (callee.type === "CallExpression") {
    // `test.each(table)(...)`, `describe.only.each`...
    const inner = callee.callee;
    if (inner.type !== "MemberExpression" || inner.computed) return null;
    if (inner.property.type !== "Identifier" || inner.property.name !== "each") return null;
    const kind = kindOf(inner.object);
    return kind === null ? null : { kind, each: true };
  }
  if (callee.type === "TaggedTemplateExpression") return null;
  const kind = kindOf(callee);
  return kind === null ? null : { kind, each: false };
}

function kindOf(callee: Expression | Super): Kind | null {
  if (callee.type === "Identifier") return KINDS.get(callee.name) ?? null;
  if (callee.type !== "MemberExpression" || callee.computed) return null;
  if (callee.property.type !== "Identifier" || !MODIFIERS.has(callee.property.name)) return null;
  return kindOf(callee.object);
}

/** One test or suite call: an entry for a test, then its callback under the new prefix. */
function declare(
  call: CallExpression,
  { kind, each }: Classified,
  ancestors: readonly string[],
  source: string,
  found: Found[],
): void {
  // `locations: true` sets `loc`; acorn columns are 0-based, Jest's are 1-based.
  const start = call.loc?.start ?? { line: 0, column: -1 };
  const location = { line: start.line, column: start.column + 1 };
  const first = call.arguments[0];
  const title = first === undefined ? null : literalName(first);
  if (each || title === null) {
    // Its children, or its cases, are known once the file has run: named by its title template,
    // or by its source text when the title is computed.
    const template =
      title ?? (first === undefined ? "<anonymous>" : source.slice(first.start, first.end));
    found.push({ ancestors, title: template, templated: true, location });
    return;
  }
  if (kind === "test") {
    found.push({ ancestors, title, templated: false, location });
    return;
  }
  const callback = call.arguments[1];
  if (callback?.type === "ArrowFunctionExpression" || callback?.type === "FunctionExpression") {
    visit(callback.body, [...ancestors, title], source, found);
  }
}

/** A string literal or a template literal without substitutions; anything else is non-literal. */
function literalName(arg: AnyNode): string | null {
  if (arg.type === "Literal" && typeof arg.value === "string") return arg.value;
  if (arg.type === "TemplateLiteral" && arg.expressions.length === 0)
    return arg.quasis[0]?.value.cooked ?? null;
  return null;
}

function isNode(value: unknown): value is AnyNode {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { type?: unknown }).type === "string"
  );
}
