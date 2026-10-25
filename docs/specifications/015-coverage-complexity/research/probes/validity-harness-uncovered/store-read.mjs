// Throwaway probe (row 015-58): reads Squeal's stores read-only. Run from the repository root:
//   node <probe>/store-read.mjs <common-dir>/squeal <coordinator worktree root>
import { DatabaseSync } from "node:sqlite";
import { inflateRawSync } from "node:zlib";
import { build } from "esbuild";

const [dir, root] = process.argv.slice(2);
const st = new DatabaseSync(`${dir}/store.sqlite`, { readOnly: true });
const cd = new DatabaseSync(`${dir}/code.sqlite`, { readOnly: true });
const TARGET = "test/keys/validity/harness/assemble.ts";
const wt = st.prepare("select id, daemon_version from worktrees where root = ?").get(root);
const id = wt.id;
const rev = st.prepare("select max(number) n from revisions where worktree_id = ?").get(id).n;
console.log(`worktree ${id}, daemon ${wt.daemon_version}, newest revision ${rev}`);
console.log(cd.prepare("select blob, revision from files where worktree_id = ? and path = ?").get(id, TARGET));

console.log("\n## States of", TARGET);
const states = cd
  .prepare(`select c.qualified_name q, s.measure m, s.outcome o, s.value v from states s
    join checks c on c.id = s.check_id where s.worktree_id = ? and c.path = ? order by c.id, s.measure`)
  .all(id, TARGET);
const byName = new Map();
for (const s of states) byName.set(s.q, { ...byName.get(s.q), [s.m]: s.v ?? s.o, [`${s.m}Outcome`]: s.o });
for (const [q, s] of byName)
  console.log(`  ${q}: cc ${s.complexity}, crap ${s.crap} (${s.crapOutcome}), uncovered ${s.uncoveredOutcome}`);

console.log("\n## Transitions (crap, uncovered)");
for (const t of cd
  .prepare(`select c.qualified_name q, t.measure m, t.kind k, t.to_outcome o, t.to_value v, t.revision r, t.at
    from transitions t join checks c on c.id = t.check_id
    where t.worktree_id = ? and c.path = ? and t.measure in ('crap', 'uncovered') order by t.id`)
  .all(id, TARGET))
  console.log(`  ${t.q} ${t.m} ${t.k} -> ${t.o} ${t.v ?? ""} at revision ${t.r}, ${t.at}`);

const record = new Map();
const recordOf = (key) => {
  if (!record.has(key)) {
    const row = cd.prepare("select record, recorded_at from coverage where result_key = ? and provider_version = 2").get(key);
    record.set(key, row ? { ...JSON.parse(inflateRawSync(row.record).toString("utf8")), at: row.recorded_at } : null);
  }
  return record.get(key);
};
const bit = (text, line) => ((Buffer.from(text, "base64")[(line - 1) >> 3] ?? 0) & (1 << ((line - 1) & 7))) !== 0;

console.log("\n## Loaders of", TARGET, "(main store closures; the daemon reads its own)");
const keys = st.prepare("select project, path, key, revision, pending from test_file_keys where worktree_id = ?").all(id);
const loadersOf = new Map();
for (const k of keys) {
  const t = st.prepare("select closure_paths from test_files where project = ? and path = ?").get(k.project, k.path);
  if (t === undefined) continue;
  for (const p of JSON.parse(t.closure_paths)) {
    if (p === k.path) continue;
    if (!loadersOf.has(p)) loadersOf.set(p, []);
    loadersOf.get(p).push(k);
  }
}
for (const k of loadersOf.get(TARGET) ?? []) {
  const results = st
    .prepare(`select r.outcome o, count(*) n, max(r.recorded_at) at, r.worktree_id w, r.revision rev from results r
      join checks c on c.id = r.check_id where r.key = ? and c.project = ? and c.test_path = ? group by r.outcome`)
    .all(k.key, k.project, k.path);
  const rec = recordOf(k.key);
  const source = rec?.sources.find((s) => s.path === TARGET);
  const covered = [];
  if (source) for (let l = 1; l <= 211; l++) if (bit(source.covered, l)) covered.push(l);
  console.log(`  ${k.path} key ${k.key.slice(0, 12)} pending ${k.pending}`);
  console.log(`    results: ${results.map((r) => `${r.n} ${r.o} (worktree ${r.w}, revision ${r.rev}, at ${r.at})`).join("; ")}`);
  console.log(`    record: ${rec === null ? "none" : `stored ${rec.at}, ${rec.sources.length} sources, unread ${rec.unread.length}`}`);
  if (rec !== null)
    console.log(source === undefined ? "    no entry for the source"
      : `    blob ${source.blob}, covered lines ${JSON.stringify(covered)}, V8 functions ${source.functions.length}, ran ${source.functions.filter((f) => f[4] === 1).length}`);
}

console.log("\n## Every 'uncovered' fail in the worktree, by what the records say of its source");
const bundle = await build({
  entryPoints: ["test/keys/validity/driver.ts"], bundle: true, platform: "node", format: "esm",
  packages: "external", write: false, metafile: true, logLevel: "silent", outfile: "x.mjs",
});
const driver = new Set(Object.keys(bundle.metafile.inputs));
const fails = cd
  .prepare(`select c.path p, count(*) n from states s join checks c on c.id = s.check_id
    where s.worktree_id = ? and s.measure = 'uncovered' and s.outcome = 'fail' group by c.path`)
  .all(id);
const totals = {};
const inBundle = [];
for (const f of fails) {
  const ls = loadersOf.get(f.p) ?? [];
  const kind = ls.length === 0 ? "no loader"
    : ls.some((l) => l.key && recordOf(l.key)?.sources.some((s) => s.path === f.p)) ? "loaded in-process, function never called"
    : "in a closure, never loaded in-process";
  totals[kind] ??= { files: 0, functions: 0 };
  totals[kind].files++;
  totals[kind].functions += f.n;
  if (driver.has(f.p)) inBundle.push(`${f.n} ${f.p} (${kind})`);
}
console.log(`  total: ${fails.reduce((a, f) => a + f.n, 0)} functions in ${fails.length} files`);
for (const [kind, t] of Object.entries(totals)) console.log(`  ${kind}: ${t.functions} functions in ${t.files} files`);
console.log(`\n## Of them, in the validity driver's bundle (${driver.size} inputs)`);
for (const line of inBundle) console.log(`  ${line}`);
const validity = fails.filter((f) => f.p.startsWith("test/keys/validity/") && !driver.has(f.p));
console.log("\n## test/keys/validity files outside the driver's bundle");
for (const f of validity) console.log(`  ${f.n} ${f.p}`);
