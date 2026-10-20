// THROWAWAY probe (011-core/research/edit-cut.md, question 1). For every changed source of the
// agent revisions (results/classified-<repo>.json.gz) of cezar and Squeal, how many namesake test
// files each matcher of lib.mjs finds among the test files present at the revision: exactly one,
// several, or none; and whether the namesake the revision's rule (n) picks is re-keyed by the
// revision, and how (direct, transitive, …). Counted per (revision, source) and per distinct
// source. A third repository with a store but no closures (mvp-unveiled-july26, its 329
// revisions' changed code files against its test files at HEAD) is counted by layout only.
// Writes results/namesakes.txt and results/namesakes.json.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { MATCHERS, namesakeOf, namesakes, readClassified, sourceStem } from "./lib.mjs";

const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|py)$/;
const lines = [];
const log = (s = "") => { lines.push(s); console.log(s); };
const json = {};
const bucket = (n) => (n === 0 ? "none" : n === 1 ? "one" : "several");

function tally(name, items) {
  // items: [{ src, n: {matcher: [paths]}, pick: [paths] }]
  const row = {};
  for (const k of [...Object.keys(MATCHERS), "rule (n)"]) {
    const c = { one: 0, several: 0, none: 0 };
    for (const it of items) c[bucket(k === "rule (n)" ? it.pick.length : it.n[k].length)]++;
    row[k] = c;
  }
  log(`${name}: ${items.length}`);
  for (const [k, c] of Object.entries(row)) log(`  ${k.padEnd(10)} one ${String(c.one).padStart(4)}  several ${String(c.several).padStart(4)}  none ${String(c.none).padStart(4)}  (one ${(100 * c.one / items.length).toFixed(0)} %)`);
  return row;
}

for (const repo of ["cezar", "squeal"]) {
  const revs = readClassified(repo);
  for (const [label, set] of [["agent revisions", revs], ["central (200 or more present files re-keyed)", revs.filter((r) => r.files.filter((f) => f.cls !== "absent").length >= 200)]]) {
    const occ = [], how = {};
    for (const r of set) {
      const byPath = new Map(r.files.map((f) => [f.path, f]));
      for (const s of r.sources) {
        const n = namesakes(s, r.present), pick = namesakeOf(s, r.present);
        occ.push({ rev: r.rev, src: s, code: CODE.test(s), n, pick, how: pick.map((p) => byPath.get(p)?.cls ?? "not re-keyed") });
        for (const h of occ.at(-1).how) how[h] = (how[h] ?? 0) + 1;
      }
    }
    log(`\n== ${repo}, ${label}: ${set.length} revisions, ${occ.length} (revision, changed keyed source) pairs, ${occ.filter((o) => o.code).length} of them code`);
    const code = occ.filter((o) => o.code);
    json[`${repo} ${label}`] = { pairs: tally("code sources, per pair", code) };
    const distinct = [...new Map(code.map((o) => [o.src, o])).values()];
    json[`${repo} ${label}`].distinct = tally("code sources, distinct", distinct);
    log(`  the picked namesake in the revision's re-keyed files: ${JSON.stringify(how)}`);
    const none = [...new Set(code.filter((o) => o.pick.length === 0).map((o) => o.src))];
    log(`  distinct code sources with no namesake under rule (n) (${none.length}): ${none.slice(0, 40).join(", ")}${none.length > 40 ? ", …" : ""}`);
    const several = [...new Set(code.filter((o) => o.pick.length > 1).map((o) => `${o.src} → ${o.pick.join(" | ")}`))];
    log(`  several (${several.length}): ${several.slice(0, 12).join("; ")}`);
    const nonCode = [...new Set(occ.filter((o) => !o.code).map((o) => o.src))];
    log(`  non-code keyed sources changed (never a namesake): ${nonCode.length}: ${nonCode.slice(0, 15).join(", ")}`);
  }
}

// mvp-unveiled-july26: its store has revisions but no test files or results; layout only.
const MVP = "/home/agent/projects/mvp-unveiled-july26";
const mvpFiles = execFileSync("git", ["-C", MVP, "ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
const isTest = (p) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(p) || /(^|\/)(test_[^/]*|[^/]*_test)\.py$/.test(p);
const mvpTests = mvpFiles.filter(isTest);
const db = new DatabaseSync("/tmp/r25b/mvp-store.sqlite", { readOnly: true });
const changedSrc = new Set();
for (const r of db.prepare("select changes from revisions where trigger = 'watch'").all()) for (const c of JSON.parse(r.changes)) if (CODE.test(c.path) && !isTest(c.path) && !c.path.includes("node_modules/") && mvpFiles.includes(c.path)) changedSrc.add(c.path);
log(`\n== mvp-unveiled-july26 (Vitest layout, no closures in its store): ${mvpTests.length} test files at HEAD, ${changedSrc.size} distinct code sources its watch revisions changed`);
const mvpItems = [...changedSrc].map((s) => ({ src: s, n: namesakes(s, mvpTests), pick: namesakeOf(s, mvpTests) }));
json.mvp = tally("code sources, distinct", mvpItems);
log(`  no namesake: ${mvpItems.filter((o) => !o.pick.length).map((o) => o.src).slice(0, 25).join(", ")}`);
const allSrc = mvpFiles.filter((p) => /\.[cm]?[jt]sx?$/.test(p) && !isTest(p) && /(^|\/)(src|app|lib)\//.test(p) && sourceStem(p) !== "index");
json.mvpAll = tally("every code source under src/app/lib at HEAD (layout)", allSrc.map((s) => ({ src: s, n: namesakes(s, mvpTests), pick: namesakeOf(s, mvpTests) })));

writeFileSync(new URL("results/namesakes.txt", import.meta.url), lines.join("\n") + "\n");
writeFileSync(new URL("results/namesakes.json", import.meta.url), JSON.stringify(json, null, 1));
