import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { pythonParserReady, withPythonTree } from "../../../runners/pytest/graph/parse.js";
import type { CodeLanguage } from "../../types/code.js";
import { loadTsxGrammar } from "./wasm.js";

let tsx: Parser | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the counter's two grammars once per process (spec 015 D4: tree-
 * sitter's start happens once per daemon). web-tree-sitter's runtime is
 * initialised once per process, by the pytest graph's loader, which also
 * loads the shipped Python grammar: a second `Parser.init` would replace the
 * runtime under every parser already made. A load that fails is made again
 * at the next call, so a retried count can succeed (row 015-18): only the
 * stage that failed, the runtime, the Python grammar or TSX's, as the
 * pytest loader keeps the stages it made (review 0.1.293 B3).
 */
export function counterReady(): Promise<void> {
  loading ??= (async () => {
    await pythonParserReady();
    const language = await Language.load(loadTsxGrammar());
    const created = new Parser();
    created.setLanguage(language);
    tsx = created;
  })().catch((error: unknown) => {
    loading = null;
    throw error;
  });
  return loading;
}

/** Runs `fn` over the parse of `text` in `language`, freeing the tree after. */
export function withCodeTree<T>(language: CodeLanguage, text: string, fn: (root: Node) => T): T {
  if (language === "python") return withPythonTree(text, fn);
  if (tsx === null) throw new Error("code counter: the TSX grammar is not loaded yet");
  const tree = tsx.parse(tsxInput(text)) as Tree;
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** `import("x")` with one plain string: no line break, backslash, `$` or backtick in it. */
const IMPORT_LITERAL = String.raw`import[ \t]*\([ \t]*(?:'[^'\n\\$\x60]*'|"[^"\n\\$\x60]*")[ \t]*\)`;
const TYPE_IMPORT = new RegExp(String.raw`(?<=\btypeof\s+|[<,]\s*)${IMPORT_LITERAL}`, "g");

/**
 * The text tree-sitter-tsx 0.23.2 parses as the file means, each change the
 * same length, so every range stays (`README.md`, "Gaps of 0.23.2"). Names
 * and body hashes are read from the file's own text.
 */
function tsxInput(text: string): string {
  // tree-sitter reads a NUL as the end of the input, but JS allows a raw one in a string, a
  // template or a comment. Python never holds one (CPython refuses it).
  const input = text.replaceAll("\0", " ");
  // It reads `f<typeof import("x")>()` and `f<import("x").T>()` as comparisons (row 015-29): an
  // identifier of underscores in place of the `import(…)` makes them type arguments again.
  return input.includes("import")
    ? input.replace(TYPE_IMPORT, (match) => "_".repeat(match.length))
    : input;
}
