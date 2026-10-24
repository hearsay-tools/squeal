// Throwaway probe for 016-11: list 016-09's class E items (deduplicated, plus residuals marked)
// with a short excerpt, for reading. Usage: node eitems.mjs <items.jsonl> <classes.tsv> [chars]
import { readFileSync } from "node:fs";

const [itemsPath, classesPath, chars = "420"] = process.argv.slice(2);
const items = readFileSync(itemsPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const cls = new Map(readFileSync(classesPath, "utf8").trim().split("\n").map((l) => { const [id, p, s] = l.split("\t"); return [id, { p, s: s || "" }]; }));
// Same residual filter as 016-09's tally.mjs.
const RESIDUAL = /residual|still|remains|remaining|prior|again|partially|unchanged|reproduction fixed/i;
const NOT_RESIDUAL = new Set(["R213"]);
for (const i of items) {
  const c = cls.get(i.id);
  if (!c || c.p !== "E") continue;
  const res = i.src === "review" && RESIDUAL.test(i.title) && !NOT_RESIDUAL.has(i.id);
  const body = i.body.replace(/^\|[^|]*\|[^|]*\|/, "").slice(0, Number(chars));
  console.log(`${i.id}${res ? " RESIDUAL" : ""} [${i.spec} ${i.date ?? "-"} ${i.where} ${i.kind}${c.s ? " E/" + c.s : ""}] ${i.title.slice(0, 200)} :: ${i.paths.join(" ")} :: ${body}`);
}
