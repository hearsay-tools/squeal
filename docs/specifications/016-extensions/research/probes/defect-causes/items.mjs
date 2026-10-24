// Throwaway probe for 016-09: one item list from FAIL-review items, escaped-defect board rows,
// the board's Later list and GitHub issues no row covers. Duplicates are dropped by issue number.
// Usage: node items.mjs <repo-root> <reviews.jsonl> <rows.jsonl> <issues.json>  -> items.jsonl on stdout.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const [root, reviewsPath, rowsPath, issuesPath] = process.argv.slice(2);
const jl = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const tags = execFileSync("git", ["-C", root, "for-each-ref", "--format=%(refname:short) %(creatordate:short)", "refs/tags/squeal--v*"], { encoding: "utf8" })
  .trim().split("\n").map((l) => { const [t, d] = l.split(" "); return [Number(t.split(".").pop()), d]; }).sort((a, b) => a[0] - b[0]);
const dateOf = (text) => {
  const m = text.match(/\b0\.1\.(\d+)\b/);
  if (!m) return null;
  const v = Number(m[1]);
  return (tags.find(([t]) => t >= v) ?? tags[tags.length - 1])[1];
};
const paths = (text) => [...new Set(text.match(/`?((?:src|test|evals|plugins|scripts)\/[\w./-]+(?::\d+)?)`?/g) ?? [])].slice(0, 3).map((p) => p.replace(/`/g, ""));

const items = [];
let n = 0;
for (const r of jl(reviewsPath)) {
  if (!r.verdict.startsWith("FAIL")) continue;
  for (const it of r.items) items.push({ id: `R${++n}`, src: "review", spec: r.spec.slice(0, 3), date: r.date, where: r.file.split("/").pop(), kind: it.kind, title: it.title, paths: paths(it.title + " " + it.body), body: it.body });
}
const covered = new Set();
n = 0;
for (const r of jl(rowsPath)) {
  const isIssue = r.origin === "issue";
  const escaped = isIssue || (r.kind === "defect-row" && (r.origin === "dogfood" || r.origin === "defect"));
  if (!escaped) continue;
  for (const m of r.text.matchAll(/(?:gh-|issues\/|#)(\d+)\b/g)) covered.add(Number(m[1]));
  items.push({ id: `D${++n}`, src: isIssue ? "issue-row" : "defect-row", spec: /^\d{3}/.test(r.id) ? r.id.slice(0, 3) : "011", date: dateOf(r.status + " " + r.text), where: r.id, kind: r.status.split(/[ (;,]/)[0], title: r.head, paths: paths(r.text), body: r.text.slice(0, 600) });
}
const board = readFileSync(join(root, "docs/board.md"), "utf8");
const later = board.slice(board.indexOf("## Later")).split("\n").filter((l) => l.startsWith("- "));
n = 0;
for (const l of later) {
  for (const m of l.matchAll(/(?:gh-|issues\/|#)(\d+)\b/g)) covered.add(Number(m[1]));
  items.push({ id: `L${++n}`, src: "later", spec: l.slice(2, 5), date: dateOf(l), where: "Later", kind: "later", title: l.slice(2, 260), paths: paths(l), body: l.slice(0, 600) });
}
n = 0;
for (const i of JSON.parse(readFileSync(issuesPath, "utf8"))) {
  if (covered.has(i.number)) continue;
  items.push({ id: `I${i.number}`, src: "issue", spec: "?", date: i.createdAt.slice(0, 10), where: `#${i.number} ${i.state}`, kind: i.labels.map((l) => l.name).join(","), title: i.title, paths: paths(i.body ?? ""), body: (i.body ?? "").replace(/\s+/g, " ").slice(0, 600) });
}
for (const i of items) console.log(JSON.stringify(i));
