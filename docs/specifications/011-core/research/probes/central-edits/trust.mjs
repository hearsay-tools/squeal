// THROWAWAY probe (011-core/research/central-edits.md). How far graph.mjs can be trusted: at the
// commit most stored closures were written from (a8042ec3: worktrees f3ab1acc and ba5234dc, 486 of
// 914 rows, 2026-10-19 22:13Z to 22:19Z), each fast test file's static reach against its stored
// closure (Squeal's own walk: Vite's transform graph for Vitest, Squeal's graph for node:test),
// both cut to code files that exist in the tree. Declared inputs (squeal.config.json `inputs`)
// are in the stored closure and in no import graph, so they are counted apart.
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { depths, graphAt, writeResult } from "./graph.mjs";

const SHA = process.argv[2] ?? "a8042ec3bd612612a287dcf3646a14f572d1d491";
const db = new DatabaseSync(process.env.R25_STORE ?? "/tmp/r3/cezar-store.sqlite", { readOnly: true });
const SLOW = /^packages\/web\/e2e\/[^/]*\.e2e\.ts$/;
const CODE = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/;
const inputs = JSON.parse(execSync(`git -C /home/agent/projects/cezar show ${SHA}:squeal.config.json`, { encoding: "utf8" })).inputs ?? {};
const globs = Object.entries(inputs).map(([test, gs]) => ({ test: globRe(test), gs: gs.map(globRe) }));
function globRe(g) {
  const re = g.replace(/[.+^$()|[\]\\]/g, "\\$&").replace(/\{([^}]+)\}/g, (_, a) => `(${a.split(",").join("|")})`)
    .replace(/\*\*\//g, "\u0001").replace(/\*\*/g, "\u0002").replace(/\*/g, "[^/]*").replace(/\u0001/g, "(.*/)?").replace(/\u0002/g, ".*");
  return new RegExp(`^${re}$`);
}
const declared = (test, path) => globs.some((g) => g.test.test(test) && g.gs.some((r) => r.test(path)));

const g = graphAt(SHA);
const rows = db.prepare("select project, path, closure_paths, updated_by from test_files").all().filter((r) => !SLOW.test(r.path));
const out = [];
for (const r of rows) {
  if (!g.files.has(r.path)) continue;
  const stored = new Set(JSON.parse(r.closure_paths).filter((p) => CODE.test(p) && g.files.has(p) && !declared(r.path, p)));
  const reach = new Set([...depths(g.edges, r.path).keys()]);
  const both = [...stored].filter((p) => reach.has(p)).length;
  out.push({ project: r.project, path: r.path, atHead: ["f3ab1acc6f8ab931", "ba5234dcb8b7abbe"].includes(r.updated_by), stored: stored.size, reach: reach.size, both,
    missing: [...stored].filter((p) => !reach.has(p)), extra: [...reach].filter((p) => !stored.has(p)).slice(0, 5) });
}
const sum = (xs) => {
  const exact = xs.filter((x) => x.both === x.stored && x.both === x.reach).length;
  const s = xs.reduce((a, x) => a + x.stored, 0), rch = xs.reduce((a, x) => a + x.reach, 0), b = xs.reduce((a, x) => a + x.both, 0);
  return { files: xs.length, exact, recall: +(b / s).toFixed(4), precision: +(b / rch).toFixed(4) };
};
const table = {};
for (const p of [...new Set(out.map((o) => o.project))]) table[p] = sum(out.filter((o) => o.project === p));
table["all, written at this head"] = sum(out.filter((o) => o.atHead));
table.all = sum(out);
console.log(`graph at ${SHA.slice(0, 8)}: ${g.files.size} code files, ${g.failed.length} did not parse: ${g.failed.slice(0, 5).join(", ")}`);
console.table(table);
const worst = out.filter((o) => o.atHead && (o.both !== o.stored || o.both !== o.reach)).slice(0, 12);
for (const w of worst) console.log(w.project, w.path, `stored ${w.stored} reach ${w.reach} both ${w.both}`, "missing", w.missing.join(" "), "extra", w.extra.join(" "));
writeResult("trust", { sha: SHA, failed: g.failed, table, files: out });
