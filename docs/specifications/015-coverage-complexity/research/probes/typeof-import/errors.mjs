// Throwaway probe (015-25). The root's top-level children and the first ERROR and MISSING nodes of one file.
// node errors.mjs <file>
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
const ROOT = fileURLToPath(new URL("../../../../../../", import.meta.url));
const { Parser, Language } = await import(`${ROOT}node_modules/web-tree-sitter/web-tree-sitter.js`);
await Parser.init(); const parser = new Parser();
parser.setLanguage(await Language.load(readFileSync(`${ROOT}src/core/code/count/tree-sitter-tsx.wasm`)));
const text = readFileSync(process.argv[2], "utf8");
const tree = parser.parse(text);
const r = tree.rootNode; console.log(r.type, r.hasError, r.childCount);
for (let i = 0; i < Math.min(r.childCount, 15); i++) { const c = r.child(i); console.log(i, c.type, c.startPosition.row + 1, c.endPosition.row + 1, JSON.stringify(c.text.slice(0, 60))); }
// smallest ERROR / MISSING nodes
const errs = []; (function w(n) { if (n.type === "ERROR" || n.isMissing) errs.push(n); for (let i = 0; i < n.childCount; i++) w(n.child(i)); })(r);
for (const e of errs.slice(0, 10)) console.log("ERR", e.type, e.isMissing, e.startPosition.row + 1, e.startPosition.column, e.endPosition.row + 1, e.childCount, JSON.stringify(e.text.slice(0, 80)));
