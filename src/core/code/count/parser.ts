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
 * runtime under every parser already made.
 */
export function counterReady(): Promise<void> {
  loading ??= (async () => {
    await pythonParserReady();
    const language = await Language.load(loadTsxGrammar());
    const created = new Parser();
    created.setLanguage(language);
    tsx = created;
  })();
  return loading;
}

/** Runs `fn` over the parse of `text` in `language`, freeing the tree after. */
export function withCodeTree<T>(language: CodeLanguage, text: string, fn: (root: Node) => T): T {
  if (language === "python") return withPythonTree(text, fn);
  if (tsx === null) throw new Error("code counter: the TSX grammar is not loaded yet");
  // tree-sitter reads a NUL as the end of the input, but JS allows a raw one in a string, a
  // template or a comment. A space keeps every offset. Python never holds one (CPython refuses it).
  const tree = tsx.parse(text.replaceAll("\0", " ")) as Tree;
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}
