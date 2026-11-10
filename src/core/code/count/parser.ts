import { Language, type Node, Parser, type Tree } from "web-tree-sitter";
import { pythonParserReady, withPythonTree } from "../../../runners/python/parser.js";
import type { CodeLanguage } from "../../types/code.js";
import { loadTsxGrammar } from "./wasm.js";

let tsx: Parser | null = null;
let loading: Promise<void> | null = null;

/**
 * Loads the counter's two grammars once per process (spec 015 D4: tree-
 * sitter's start happens once per daemon). web-tree-sitter's runtime is
 * initialised once per process, by the shared Python parser in
 * `src/runners/python/` (row 016-36), which also loads the shipped Python
 * grammar: a second `Parser.init` would replace the runtime under every
 * parser already made. A load that fails is made again at the next call, so
 * a retried count can succeed (row 015-18): only the stage that failed, the
 * runtime, the Python grammar or TSX's, as the Python loader keeps the
 * stages it made (review 0.1.293 B3).
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
  const tree = parseTsx(tsx, text);
  try {
    return fn(tree.rootNode);
  } finally {
    tree.delete();
  }
}

/** `import("x")` with one plain string: no line break, backslash, `$` or backtick in it. */
const IMPORT_LITERAL = String.raw`import[ \t]*\([ \t]*('[^'\n\\$\x60]*'|"[^"\n\\$\x60]*")[ \t]*\)`;
const TYPE_IMPORT = new RegExp(String.raw`(?<=\btypeof\s+|[<,]\s*)${IMPORT_LITERAL}`, "g");

/**
 * A backslash and the character after it. The group holds the `x` or `u` of
 * an escape with no valid digits after it. `\\` is one pair, so the `x` of
 * `\\x` starts no escape.
 */
const ESCAPE = /\\(?:(x(?![0-9a-fA-F]{2})|u(?![0-9a-fA-F]{4}|\{[0-9a-fA-F]+\}))|[\s\S])/g;

/** A parse input and its tree. */
interface Parse {
  readonly input: string;
  readonly tree: Tree;
}

/**
 * The tree of what the file means, from text tree-sitter-tsx 0.23.2 parses
 * as the file means, each change the same length, so every range stays
 * (`README.md`, "Gaps of 0.23.2"). Names and body hashes are read from the
 * file's own text. A further parse is made only for a file with a rewrite,
 * or with a parse error and an escape to try.
 */
function parseTsx(parser: Parser, text: string): Tree {
  // tree-sitter reads a NUL as the end of the input, but JS allows a raw one in a string, a
  // template or a comment. Python never holds one (CPython refuses it).
  const input = text.replaceAll("\0", " ");
  const parsed: Parse = { input, tree: parser.parse(input) as Tree };
  return withTypeImports(parser, withTaggedEscapes(parser, parsed)).tree;
}

/**
 * A tagged template may hold `\x` or `\u` with no valid digits (ES2018), as
 * in String.raw`got "\x"`, but the grammar reads every such escape as an
 * error (row 020-12). Each one is parsed as `\_`. A rewrite is kept only
 * where the new parse reads it as an escape of a tagged template, so the
 * same escape in a string, an untagged template, a comment or a regular
 * expression stays as written.
 */
function withTaggedEscapes(parser: Parser, parsed: Parse): Parse {
  const { input, tree } = parsed;
  if (!tree.rootNode.hasError) return parsed;
  const escapes = [...input.matchAll(ESCAPE)].flatMap((m) => (m[1] === undefined ? [] : [m.index]));
  if (escapes.length === 0) return parsed;
  const tried = parser.parse(underscored(input, escapes)) as Tree;
  const tagged = escapes.filter((at) => isTaggedEscape(tried.rootNode, at));
  if (tagged.length === 0) {
    tried.delete();
    return parsed;
  }
  tree.delete();
  const rewritten = underscored(input, tagged);
  if (tagged.length === escapes.length) return { input: rewritten, tree: tried };
  tried.delete();
  return { input: rewritten, tree: parser.parse(rewritten) as Tree };
}

/** `input` with `_` in place of the character after each backslash at `escapes`. */
function underscored(input: string, escapes: readonly number[]): string {
  let out = "";
  let from = 0;
  for (const at of escapes) {
    out += `${input.slice(from, at + 1)}_`;
    from = at + 2;
  }
  return out + input.slice(from);
}

/** Whether the parse reads the two characters at `at` as one escape of a tagged template. */
function isTaggedEscape(root: Node, at: number): boolean {
  if (!spans(root, "escape_sequence", at, at + 2)) return false;
  const template = root.descendantForIndex(at, at + 2)?.parent;
  const call = template?.parent;
  return (
    template?.type === "template_string" &&
    call?.type === "call_expression" &&
    call.childForFieldName("arguments")?.equals(template) === true
  );
}

/**
 * It reads `f<typeof import("x")>()` and `f<import("x").T>()` as comparisons
 * (row 015-29): an identifier of underscores in place of the `import(…)`
 * makes them type arguments again.
 */
function withTypeImports(parser: Parser, parsed: Parse): Parse {
  const { input, tree } = parsed;
  if (!input.includes("import")) return parsed;
  let changed = false;
  const rewritten = input.replace(TYPE_IMPORT, (match: string, literal: string, at: number) => {
    if (!isImportSyntax(tree.rootNode, match, literal, at)) return match;
    changed = true;
    return "_".repeat(match.length);
  });
  if (!changed) return parsed;
  tree.delete();
  return { input: rewritten, tree: parser.parse(rewritten) as Tree };
}

/**
 * Whether the parse of the unrewritten text reads a match at `at` as an
 * `import` keyword and one string, the match's own literal. A match can
 * start inside a string, a comment, a template or a regular expression and
 * end inside another: its underscores would erase the code between them
 * (review 0.1.295 B1).
 */
function isImportSyntax(root: Node, match: string, literal: string, at: number): boolean {
  const from = at + match.indexOf(literal);
  return (
    spans(root, "import", at, at + "import".length) &&
    spans(root, "string", from, from + literal.length)
  );
}

/** Whether the smallest node over `[start, end)` is a `type` node with exactly that range. */
function spans(root: Node, type: string, start: number, end: number): boolean {
  const node = root.descendantForIndex(start, end);
  return node?.type === type && node.startIndex === start && node.endIndex === end;
}
