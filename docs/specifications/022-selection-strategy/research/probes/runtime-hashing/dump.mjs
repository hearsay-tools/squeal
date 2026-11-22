// Throwaway: prints the tree of a snippet, one node per line.
import { tsx } from "./ts.mjs";
const p = await tsx();
const src = process.argv[2];
const t = p.parse(src);
function walk(n, d) {
  const leaf = n.childCount === 0;
  console.log(`${"  ".repeat(d)}${n.isNamed ? n.type : JSON.stringify(n.type)}${n.fieldName ?? ""} [${n.startIndex},${n.endIndex}]${leaf ? " " + JSON.stringify(n.text) : ""}${n.isError ? " ERROR" : ""}${n.isMissing ? " MISSING" : ""}`);
  for (let i = 0; i < n.childCount; i++) walk(n.child(i), d + 1);
}
walk(t.rootNode, 0);
