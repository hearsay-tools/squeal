// Throwaway probe for 016-11: cost per feature thread, a second view beside the mechanism groups.
// The thread lists are this researcher's reading. Usage: node threads.mjs <items.jsonl> <rows2.jsonl>
import { readFileSync } from "node:fs";

const [itemsPath, rowsPath] = process.argv.slice(2);
const jl = (p) => readFileSync(p, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const items = new Map(jl(itemsPath).map((i) => [i.id, i]));
const THREADS = {
  "status --wait edit window and re-key record": "R61 R62 R69 R70 R136 R137 R145 R147 R153 R194 R195 R226 D218 D219 D223 D226 D227 D228 D234 D247 D249 D262 D268 D269 D270 D271",
  "waiting Stop for slow files": "R71 R72 R73 R74 R75 R76 R77 R78 R87 R196 R197 R204 R208 D275 D279 D280 D281 D290 D291",
  "daemon step-down and handover": "R37 R39 R89 R90 R92 R359 R360 R380 R381 R383 D15 D16 D38 D100 D101 D102 D178 D180 D295",
  "named demand: promotions, yields, focused runs": "R345 R346 R367 R376 R384 R385 R390 R391 R392 R393 R394 R395 R397 R398 R399 D18 D22 D27 D28 D39 I14 I17",
  "install wait and dependency keys": "R14 R19 R21 R22 R23 R24 R27 R28 R29 R31 R32 R33 D164 D166 D167 D168 D169 D170",
  "slow-tier artifacts, preconditions and provenance": "R203 R207 R209 R210 R211 R212 R214 R215 R218 R221 R222 R224",
  "observed growth, heal and re-run": "R41 R79 R121 R126 R127 R128 R133 R370 D182 D195",
  "child processes: sweep, priority, leftovers": "R53 R56 R86 R113 R144 R166 R168 R170 R171 R225 R416 D189 D235 D261 D318",
  "setup gate rewording": "R227 R241 R243 R244 R245 R246 R247 R248",
  "squeal ps (014)": "R438 R440 R442 R443 R444 R445 R446 R447 R448 R449 D125 D127 D129 D130 D131 D132 D133",
  "code checks (015)": "R452 R453 R454 R455 R456 R457 R458 R459 R460 R462 R463 R467 R468 R469 R470 R471 R472 D137 D138 D139 D140 D141 D142 D143",
};
const repair = jl(rowsPath).filter((r) => r.kind === "review-repair-row" || r.origin === "review-repair");
// Same spec-aware citation rule as tally.mjs: a row's bare "reviews/<file>" is its own spec's.
const cites = (r) => {
  const out = new Set();
  const own = /^\d{3}/.test(r.id) ? r.id.slice(0, 3) : "011";
  for (const m of r.text.matchAll(/(?:(\d{3})-[\w-]+\/)?reviews\/([\w.-]+\.md)/g)) out.add(`${m[1] ?? own}/${m[2]}`);
  return out;
};
for (const [name, list] of Object.entries(THREADS)) {
  const ids = list.split(" ");
  const its = ids.map((id) => items.get(id));
  const blockers = its.filter((i) => i.src === "review" && i.kind.startsWith("blocker"));
  const rounds = [...new Set(blockers.map((i) => `${i.spec}/${i.where}`))];
  const rep = repair.filter((r) => [...cites(r)].some((c) => rounds.includes(c))).length;
  console.log(`${name}: items ${ids.length}, blockers ${blockers.length}, FAIL rounds ${rounds.length}, escaped rows ${its.filter((i) => i.src !== "review").length}, repair rows citing those rounds ${rep}\n  rounds: ${rounds.join(" ")}`);
}
