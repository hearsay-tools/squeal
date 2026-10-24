// Throwaway. Prints tree-sitter-tsx 0.23.2's tree for each snippet in a file, snippets split by lines "// ---".
// node tree.mjs <snippets file> [--full]
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const { Parser, Language } = await import(`${ROOT}node_modules/web-tree-sitter/web-tree-sitter.js`);
await Parser.init();
const parser = new Parser();
// WASM=<path> loads another build of the grammar (the shipped one by default).
const wasm = process.env.WASM ?? `${ROOT}src/core/code/count/tree-sitter-tsx.wasm`;
parser.setLanguage(await Language.load(readFileSync(wasm)));
const full = process.argv.includes("--full");
function show(node, depth, field) {
  const pad = "  ".repeat(depth);
  const tag = node.isMissing ? `MISSING ${node.type}` : node.type;
  const leaf = node.childCount === 0 || (!full && node.type === "string");
  console.log(`${pad}${field ? field + ": " : ""}${tag}${leaf ? ` ${JSON.stringify(node.text)}` : ""}`);
  if (leaf) return;
  for (let i = 0; i < node.childCount; i++) show(node.child(i), depth + 1, node.fieldNameForChild(i));
}
for (const snippet of readFileSync(process.argv[2], "utf8").split(/^\/\/ ---.*\n/m)) {
  if (!snippet.trim()) continue;
  const tree = parser.parse(snippet);
  console.log(`=== ${snippet.trim()}\n  hasError=${tree.rootNode.hasError}`);
  show(tree.rootNode, 1);
  tree.delete();
}
