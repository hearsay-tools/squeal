import { readFile } from "node:fs/promises";
import type { Node } from "web-tree-sitter";
import type { AbsolutePath, EnumeratedCheck, TestFileRef } from "../../core/types/index.js";
import { pythonParserReady, withPythonTree } from "../python/parser.js";

/** pytest's collection names (spec 007 D1): `python_functions` and `python_classes`. */
export interface CollectionNames {
  /** Default `["test"]`. */
  readonly pythonFunctions?: readonly string[];
  /** Default `["Test"]`. */
  readonly pythonClasses?: readonly string[];
}

/**
 * Static enumeration of one pytest file (spec 007 D7), named as pytest
 * names its node IDs after the path, before the file has ever run.
 *
 * Spec 007 D7: "`enumerate(testFile)` walks the tree-sitter parse of D4:
 * module-level functions matching `python_functions` (default `test*`),
 * methods of classes matching `python_classes` (default `Test*`) without an
 * `__init__`, nested classes, `unittest.TestCase` subclasses' `test*`
 * methods. A function with a `parametrize` mark, or any non-literal
 * construct, is one `templated` entry." `--collect-only` is never used.
 */
export async function enumerate(
  file: AbsolutePath,
  testFile: TestFileRef,
  names: CollectionNames = {},
): Promise<EnumeratedCheck[]> {
  const source = await readFile(file, "utf8");
  await pythonParserReady();
  return enumerateSource(source, testFile, names);
}

interface Found {
  readonly fullName: string;
  readonly templated: boolean;
  readonly line: number;
  readonly column: number;
}

/** A class's own definitions by name: the last one wins, as in the class namespace. */
interface Scope {
  readonly defs: Map<string, Node>;
  /** `pytestmark` holds a `parametrize` mark. */
  readonly parametrized: boolean;
}

/** `enumerate` over a file's source text; the parser must be loaded. */
export function enumerateSource(
  source: string,
  testFile: TestFileRef,
  names: CollectionNames = {},
): EnumeratedCheck[] {
  const functions = names.pythonFunctions ?? ["test"];
  const classes = names.pythonClasses ?? ["Test"];
  const found = withPythonTree(source, (root) => {
    const out: Found[] = [];
    const module = scope(root);
    const topClasses = new Map<string, Node>();
    for (const [name, def] of module.defs)
      if (definition(def).type === "class_definition") topClasses.set(name, def);
    const visitClass = (def: Node, prefix: string, templated: boolean, unittest: boolean): void => {
      const body = scope(definition(def).childForFieldName("body"));
      if (isFalse(body.defs.get("__test__"))) return;
      if (!unittest && body.defs.has("__init__")) return;
      const inherited = new Map<string, Node>();
      for (const base of bases(definition(def))) {
        const local = topClasses.get(base);
        if (local !== undefined && local !== def) {
          for (const [name, d] of scope(definition(local).childForFieldName("body")).defs)
            inherited.set(name, d);
        }
      }
      const all = new Map([...inherited, ...body.defs]);
      const marked = templated || body.parametrized || hasParametrize(def);
      for (const [name, member] of all) {
        const inner = definition(member);
        if (inner.type === "function_definition") {
          const collected = unittest ? name.startsWith("test") : matches(name, functions);
          if (collected)
            out.push(entry(`${prefix}${name}`, member, marked || hasParametrize(member)));
        } else if (inner.type === "class_definition" && !unittest && matches(name, classes)) {
          visitClass(member, `${prefix}${name}::`, marked, false);
        }
      }
    };
    for (const [name, def] of module.defs) {
      const inner = definition(def);
      if (inner.type === "function_definition") {
        if (matches(name, functions))
          out.push(entry(name, def, module.parametrized || hasParametrize(def)));
      } else if (inner.type === "class_definition") {
        const unittest = bases(inner).some((b) => b === "TestCase" || b.endsWith(".TestCase"));
        if (unittest || matches(name, classes))
          visitClass(def, `${name}::`, module.parametrized, unittest);
      } else if (matches(name, functions)) {
        // `test_x = make_test()`: whatever pytest finds there is known after a run.
        out.push(entry(name, def, true));
      }
    }
    return out;
  });
  return found.map((f) => ({
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName: f.fullName,
    },
    templated: f.templated,
    location: { path: testFile.path, line: f.line, column: f.column },
  }));
}

function entry(fullName: string, def: Node, templated: boolean): Found {
  return {
    fullName,
    templated,
    line: def.startPosition.row + 1,
    column: def.startPosition.column + 1,
  };
}

/**
 * The definitions a body binds at its own level: `def`, `class`, decorated
 * ones and plain assignments, in first-binding order with the last binding
 * kept, as a module or class namespace has them.
 */
function scope(body: Node | null): Scope {
  const defs = new Map<string, Node>();
  let parametrized = false;
  for (const statement of body?.namedChildren ?? []) {
    if (statement === null) continue;
    const inner = definition(statement);
    if (inner.type === "function_definition" || inner.type === "class_definition") {
      const name = inner.childForFieldName("name")?.text;
      if (name !== undefined) defs.set(name, statement);
      continue;
    }
    const assignment = statement.type === "expression_statement" ? statement.namedChild(0) : null;
    if (assignment?.type !== "assignment") continue;
    const target = assignment.childForFieldName("left");
    if (target?.type !== "identifier") continue;
    if (target.text === "pytestmark") parametrized = /\bparametrize\b/.test(assignment.text);
    defs.set(target.text, assignment);
  }
  return { defs, parametrized };
}

/** The `def` or `class` under its decorators. */
function definition(node: Node): Node {
  return node.type === "decorated_definition"
    ? (node.childForFieldName("definition") ?? node)
    : node;
}

function hasParametrize(node: Node): boolean {
  if (node.type !== "decorated_definition") return false;
  return node.namedChildren.some((c) => c?.type === "decorator" && /\bparametrize\b/.test(c.text));
}

function bases(def: Node): string[] {
  const list = def.childForFieldName("superclasses");
  return (list?.namedChildren ?? []).flatMap((b) =>
    b === null || b.type === "keyword_argument" ? [] : [b.text],
  );
}

/** `__test__ = False`. */
function isFalse(node: Node | undefined): boolean {
  return node?.type === "assignment" && node.childForFieldName("right")?.text === "False";
}

/**
 * pytest's `_matches_prefix_or_glob_option`: a prefix, or an `fnmatch` glob
 * when the option holds a wildcard.
 */
function matches(name: string, options: readonly string[]): boolean {
  return options.some(
    (option) => name.startsWith(option) || (/[*?[]/.test(option) && glob(option).test(name)),
  );
}

function glob(pattern: string): RegExp {
  let source = "";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i] as string;
    if (c === "*") source += ".*";
    else if (c === "?") source += ".";
    else if (c === "[") {
      const end = pattern.indexOf("]", i + 2);
      if (end < 0) source += "\\[";
      else {
        const body = pattern.slice(i + 1, end);
        source += `[${body.startsWith("!") ? `^${body.slice(1)}` : body}]`;
        i = end;
      }
    } else source += c.replace(/[.+^${}()|\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
}
