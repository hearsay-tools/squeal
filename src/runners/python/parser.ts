import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { loadWasm } from "./wasm.js";

/*
 * The process's one Python parser, which the pytest graph and the code
 * counter share (row 016-36). It lives outside the pytest runner's folder,
 * so an edit there re-runs no complexity test.
 */

let parser: Parser | null = null;
/** web-tree-sitter's runtime is initialised in this process. */
let runtimeReady = false;
let loading: Promise<void> | null = null;

/**
 * Compiles web-tree-sitter and the tree-sitter-python grammar once (module-
 * graph Q1); await before {@link withPythonTree}. Calls during a load share
 * it. A load that fails is made again at the next call, so the code
 * counter's retry can succeed (spec 015 D4; review 0.1.293 B3). The
 * runtime, once initialised, is not initialised again: a second
 * `Parser.init` would replace it under every parser already made.
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
  if (parser === null) throw new Error("Python parser: not loaded yet");
  const tree = parser.parse(source) as Tree;
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}
