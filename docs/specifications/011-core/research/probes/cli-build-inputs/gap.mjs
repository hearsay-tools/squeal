// Throwaway probe for 011-127 (question 2). For every test file the census saw build, reads the
// scratch store's closure and observed set, the declared inputs of squeal.config.json, and the src/
// files its builds hold (tsc: --listFiles of tsconfig.build.json, and the CLI's esbuild graph;
// esbuild: a metafile of the same entry points), and prints which src/ files the key lacks.
// usage: node gap.mjs <clone> <builders.jsonl> <tsc-listfiles.txt> [--json out.json]
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

const [clone, log, listFiles] = process.argv.slice(2);
const out = process.argv.includes("--json") ? process.argv[process.argv.indexOf("--json") + 1] : null;
const rel = (p) => (p.startsWith(`${clone}/`) ? p.slice(clone.length + 1) : p);
const esbuild = createRequire(join(clone, "package.json"))("esbuild");
const db = new DatabaseSync(join(clone, ".git/squeal/store.sqlite"), { readOnly: true });
const closures = new Map(db.prepare("SELECT project, path, closure_paths FROM test_files").all()
  .map((r) => [r.path, JSON.parse(r.closure_paths)]));
const observed = {};
for (const r of db.prepare("SELECT key, value FROM meta WHERE key LIKE 'observed.%'").all()) Object.assign(observed, JSON.parse(r.value));
const config = JSON.parse(readFileSync(join(clone, "squeal.config.json"), "utf8"));
const glob = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*\//g, "\u0000").replace(/\*\*/g, ".*").replace(/\*/g, "[^/]*").replace(/\u0000/g, "(.*/)?")}$`);
const declaredFor = (test) => Object.entries(config.inputs ?? {}).filter(([k]) => glob(k).test(test)).flatMap(([, v]) => v);
const tscSrc = readFileSync(listFiles, "utf8").split("\n").map(rel).filter((p) => p.startsWith("src/"));
const metaCache = new Map();
async function held(entries) {
  const k = entries.join(",");
  if (!metaCache.has(k)) {
    const r = await esbuild.build({ absWorkingDir: clone, entryPoints: entries, bundle: true, write: false, metafile: true,
      platform: "node", format: "esm", packages: "external", outdir: "/tmp/r127/meta/gap", logLevel: "silent" });
    metaCache.set(k, Object.keys(r.metafile.inputs).filter((p) => p.startsWith("src/")));
  }
  return metaCache.get(k);
}
const cli = await held(["src/cli/index.ts"]);
const builds = new Map();
for (const line of readFileSync(log, "utf8").trim().split("\n")) {
  const r = JSON.parse(line);
  if (!r.test?.startsWith(clone)) continue;
  const t = rel(r.test);
  const b = builds.get(t) ?? { tsc: false, entries: new Set() };
  if (r.kind === "tsc") b.tsc = true;
  else {
    const d = JSON.parse(r.detail ?? "{}");
    const eps = Array.isArray(d.entryPoints) ? d.entryPoints : Object.values(d.entryPoints ?? {});
    // Entries under a temporary tree (the validity overlays, git archive of the release) are not this worktree's.
    for (const e of eps.map((x) => (typeof x === "string" ? x : x.in))) if (!String(e).startsWith("/tmp/") || String(e).startsWith(clone)) b.entries.add(rel(String(e)));
  }
  builds.set(t, b);
}
const rows = [];
for (const [test, b] of [...builds].sort()) {
  const closure = new Set(closures.get(test) ?? []);
  const obs = observed[test] ?? [];
  const declared = declaredFor(test).map(glob);
  const keyed = (p) => closure.has(p) || obs.includes(p) || declared.some((g) => g.test(p));
  const bundle = new Set([...(b.tsc ? tscSrc : []), ...(b.entries.size ? await held([...b.entries]) : [])]);
  const loadable = new Set([...(b.tsc ? cli : []), ...(b.entries.size ? await held([...b.entries]) : [])]);
  const missing = [...bundle].filter((p) => !keyed(p));
  rows.push({ test, tsc: b.tsc, esbuildEntries: [...b.entries].length, closureSrc: [...closure].filter((p) => p.startsWith("src/")).length,
    observedSrc: obs.filter((p) => p.startsWith("src/")).length, observedOther: obs.filter((p) => !p.startsWith("src/")),
    declared: declaredFor(test), bundleSrc: bundle.size, missing: missing.length,
    missingList: missing, missingLoadable: [...loadable].filter((p) => !keyed(p)).length,
    schedulerTs: missing.includes("src/core/scheduler/scheduler.ts"), standingTs: missing.includes("src/core/status/standing.ts") });
}
for (const r of rows) console.log(`${r.test.padEnd(52)} tsc=${r.tsc ? 1 : 0} esb=${r.esbuildEntries} closure=${r.closureSrc} obs=${r.observedSrc} decl=${r.declared.length} bundle=${r.bundleSrc} missing=${r.missing} missingLoadable=${r.missingLoadable} sched=${r.schedulerTs ? "MISS" : "ok"} standing=${r.standingTs ? "MISS" : "ok"}`);
console.log("files", rows.length, "with a gap", rows.filter((r) => r.missing > 0).length,
  "scheduler.ts missed by", rows.filter((r) => r.schedulerTs).length, "standing.ts missed by", rows.filter((r) => r.standingTs).length);
if (out) writeFileSync(out, JSON.stringify(rows, null, 1));
