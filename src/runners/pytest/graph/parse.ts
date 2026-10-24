import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { loadWasm } from "./wasm.js";

/**
 * One import of a module (spec 007 D4): `import a.b` (`import`), `from
 * ..p import x` (`from`, with its level and names), or `import_module` and
 * `__import__` with a literal (`dynamic`).
 */
export interface PythonImport {
  readonly kind: "import" | "from" | "dynamic";
  /** Dotted, without the leading dots of a relative import; `""` for `from . import x`. */
  readonly module: string;
  readonly level: number;
  /** `from` names, `*` left out. */
  readonly names: readonly string[];
  readonly line: number;
}

export interface ParsedPython {
  /** Every import outside an `if TYPE_CHECKING:` body, both `try` arms and function bodies included. */
  readonly imports: readonly PythonImport[];
  /** Lines of `import_module` and `__import__` calls whose argument is not a literal. */
  readonly computed: readonly number[];
  /** A module-level `pytest_plugins` literal's modules; empty when there is none. */
  readonly pytestPlugins: readonly string[];
  /** The line of a module-level `pytest_plugins` that is not a literal of strings. */
  readonly pytestPluginsComputed: number | null;
  /** The first line tree-sitter could not parse, whose imports may be missed. */
  readonly errorLine: number | null;
}

let parser: Parser | null = null;
/** web-tree-sitter's runtime is initialised in this process. */
let runtimeReady = false;
let loading: Promise<void> | null = null;

/**
 * Compiles web-tree-sitter and the tree-sitter-python grammar once (module-
 * graph Q1); await before {@link parsePython} or {@link withPythonTree}.
 * Calls during a load share it. A load that fails is made again at the
 * next call, so the code counter's retry can succeed (spec 015 D4; review
 * 0.1.293 B3). The runtime, once initialised, is not initialised again: a
 * second `Parser.init` would replace it under every parser already made.
 */
export function pythonParserReady(): Promise<void> {
  if (parser !== null) return Promise.resolve();
  loading ??= loadPythonParser().finally(() => {
    loading = null;
  });
  return loading;
}

async function loadPythonParser(): Promise<void> {
  const wasm = loadWasm();
  if (!runtimeReady) {
    await Parser.init({ wasmBinary: wasm.runtime });
    runtimeReady = true;
  }
  const language = await Language.load(wasm.grammar);
  const created = new Parser();
  created.setLanguage(language);
  parser = created;
}

/** Runs `fn` over the parse of `source`, freeing the tree after. */
export function withPythonTree<T>(source: string, fn: (root: Node) => T): T {
  if (parser === null) throw new Error("pytest graph: the Python parser is not loaded yet");
  const tree = parser.parse(source) as Tree;
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** `TYPE_CHECKING`, `typing.TYPE_CHECKING`, `t.TYPE_CHECKING`, as `ast_graph.py`'s `is_tc` has it. */
const TYPE_CHECKING = /^(?:[\w.]+\.)?TYPE_CHECKING$/;
const DOTTED = /^[\w.]+$/;

/** Spec 007 D4's imports of one module, from tree-sitter-python. */
export function parsePython(source: string): ParsedPython {
  return withPythonTree(source, (root) => {
    const imports: PythonImport[] = [];
    const computed: number[] = [];
    const stack: Node[] = [root];
    while (stack.length > 0) {
      const node = stack.pop() as Node;
      const line = node.startPosition.row + 1;
      switch (node.type) {
        case "import_statement":
          for (const child of node.namedChildren) {
            const name = child?.type === "aliased_import" ? child.childForFieldName("name") : child;
            if (name?.type === "dotted_name") {
              imports.push({ kind: "import", module: name.text, level: 0, names: [], line });
            }
          }
          continue;
        case "import_from_statement":
        case "future_import_statement":
          imports.push(fromImport(node, line));
          continue;
        case "call": {
          const target = dynamicTarget(node);
          if (target === undefined) break;
          if (target === null) computed.push(line);
          else imports.push({ kind: "dynamic", module: target, level: 0, names: [], line });
          break;
        }
      }
      // 007-04 fix: web-tree-sitter returns a new wrapper per call, so bodies compare by id.
      const skipped = typeCheckingBodies(node);
      const children = node.namedChildren;
      for (let i = children.length - 1; i >= 0; i--) {
        const child = children[i];
        if (child && !skipped.has(child.id)) stack.push(child);
      }
    }
    imports.sort((a, b) => a.line - b.line);
    computed.sort((a, b) => a - b);
    const plugins = pytestPlugins(root);
    return {
      imports,
      computed,
      pytestPlugins: plugins.names,
      pytestPluginsComputed: plugins.computed,
      errorLine: root.hasError ? firstError(root) : null,
    };
  });
}

function fromImport(node: Node, line: number): PythonImport {
  if (node.type === "future_import_statement") {
    return { kind: "from", module: "__future__", level: 0, names: importedNames(node), line };
  }
  const target = node.childForFieldName("module_name");
  let level = 0;
  let module = target?.text ?? "";
  if (target?.type === "relative_import") {
    const prefix = target.namedChildren.find((c) => c?.type === "import_prefix");
    level = (prefix?.text ?? "").replace(/\s/g, "").length;
    module = target.namedChildren.find((c) => c?.type === "dotted_name")?.text ?? "";
  }
  return {
    kind: "from",
    module: module.replace(/\s/g, ""),
    level,
    names: importedNames(node),
    line,
  };
}

function importedNames(node: Node): string[] {
  return node
    .childrenForFieldName("name")
    .map((c) => (c?.type === "aliased_import" ? c.childForFieldName("name") : c)?.text ?? "")
    .filter((name) => name !== "");
}

/**
 * The module an `import_module(...)` or `__import__(...)` call names: the
 * literal, `null` when its first argument is not one, `undefined` for any
 * other call.
 */
function dynamicTarget(call: Node): string | null | undefined {
  const fn = call.childForFieldName("function");
  const name = fn?.type === "attribute" ? fn.childForFieldName("attribute")?.text : fn?.text;
  if (name !== "import_module" && name !== "__import__") return undefined;
  const first = call.childForFieldName("arguments")?.namedChildren[0];
  if (first === undefined || first === null) return undefined;
  const text = stringLiteral(first);
  return text !== null && DOTTED.test(text) ? text : null;
}

/** The value of a string literal without interpolation or escapes, else `null`. */
function stringLiteral(node: Node): string | null {
  if (node.type === "concatenated_string") {
    const parts = node.namedChildren.map((c) => (c === null ? null : stringLiteral(c)));
    return parts.every((p) => p !== null) ? parts.join("") : null;
  }
  if (node.type !== "string") return null;
  let text = "";
  for (const child of node.namedChildren) {
    if (child === null || child.type === "string_start" || child.type === "string_end") continue;
    if (child.type !== "string_content") return null;
    text += child.text;
  }
  return text;
}

/** The id of the body an `if TYPE_CHECKING:` or `elif TYPE_CHECKING:` guards, as a set. */
function typeCheckingBodies(node: Node): ReadonlySet<number> {
  if (node.type !== "if_statement" && node.type !== "elif_clause") return EMPTY;
  const condition = node.childForFieldName("condition")?.text ?? "";
  const body = node.childForFieldName("consequence");
  return body && TYPE_CHECKING.test(condition.replace(/\s/g, "")) ? new Set([body.id]) : EMPTY;
}
const EMPTY: ReadonlySet<number> = new Set();

/** A module-level `pytest_plugins = "a"`, `[...]` or `(...)` of strings. */
function pytestPlugins(root: Node): { names: string[]; computed: number | null } {
  const names: string[] = [];
  let computed: number | null = null;
  for (const statement of root.namedChildren) {
    const assignment = statement?.type === "expression_statement" ? statement.namedChild(0) : null;
    if (assignment?.type !== "assignment") continue;
    if (assignment.childForFieldName("left")?.text !== "pytest_plugins") continue;
    const right = assignment.childForFieldName("right");
    const items = right?.type === "list" || right?.type === "tuple" ? right.namedChildren : [right];
    const values = items.map((item) => (item ? stringLiteral(item) : null));
    if (values.every((v): v is string => v !== null && DOTTED.test(v))) {
      names.splice(0, names.length, ...values);
      computed = null;
    } else {
      computed = assignment.startPosition.row + 1;
    }
  }
  return { names, computed };
}

function firstError(root: Node): number {
  const stack: Node[] = [root];
  while (stack.length > 0) {
    const node = stack.pop() as Node;
    if (node.isError || node.isMissing) return node.startPosition.row + 1;
    const children = node.children;
    for (let i = children.length - 1; i >= 0; i--) {
      const child = children[i];
      if (child?.hasError || child?.isMissing) stack.push(child);
    }
  }
  return root.startPosition.row + 1;
}
