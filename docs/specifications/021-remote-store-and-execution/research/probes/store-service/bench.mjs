// Throwaway (021-01). Bulk import of one commit's results and a batched lookup of one
// worktree's keys, against a local SQLite file and servers in containers on loopback.
// node bench.mjs <data dir> <backend: sqlite|pg|valkey|bazel> [repeats]
// Needs `pg` and `iovalkey` in a node_modules next to the run directory (not in git).
import { readFileSync, rmSync } from "node:fs";
import { gzipSync } from "node:zlib";
import http from "node:http";
const [dir, backend, rep] = process.argv.slice(2);
const repeats = Number(rep ?? 3);
const nd = (f) => readFileSync(`${dir}/${f}`, "utf8").trim().split("\n").map((l) => JSON.parse(l));
const preload = [...nd("preload.ndjson"), ...nd("lookup-rows.ndjson")];
const imp = nd("import.ndjson");
const keys = JSON.parse(readFileSync(`${dir}/lookup-keys.json`, "utf8"));
const byKey = (rows) => { const m = new Map(); for (const r of rows) { const { key, ...rest } = r; (m.get(key) ?? m.set(key, []).get(key)).push(rest); } return m; };
const COLS = ["key", "project", "testPath", "kind", "fullName", "outcome", "durationMs", "locationPath", "locationLine", "locationColumn", "commit", "recordedAt"];
const ms = (t) => Number(process.hrtime.bigint() - t) / 1e6;
const now = () => process.hrtime.bigint();
const report = (op, times, extra = "") => console.log(`${backend} ${op}: ${times.map((t) => t.toFixed(0)).join(", ")} ms ${extra}`);

const backends = {
  async sqlite() {
    const { DatabaseSync } = await import("node:sqlite");
    const file = `${dir}/bench.sqlite`; rmSync(file, { force: true }); rmSync(file + "-wal", { force: true });
    const db = new DatabaseSync(file); db.exec("pragma journal_mode=wal; pragma synchronous=normal");
    db.exec(`create table results(key text not null, project text not null, test_path text not null, kind text not null, full_name text not null,
      outcome text, duration_ms real, location_path text, location_line int, location_column int, commit_sha text, recorded_at int,
      primary key (key, project, test_path, kind, full_name)) without rowid`);
    const ins = db.prepare("insert or ignore into results values (?,?,?,?,?,?,?,?,?,?,?,?)");
    const put = (rows) => { db.exec("begin"); for (const r of rows) ins.run(...COLS.map((c) => r[c] ?? null)); db.exec("commit"); };
    return {
      preload: put, import: put,
      clear(rows) { const del = db.prepare("delete from results where key = ?"); db.exec("begin"); for (const k of new Set(rows.map((r) => r.key))) del.run(k); db.exec("commit"); },
      lookup(ks) { db.exec("create temp table if not exists k(key text primary key); delete from k"); const i = db.prepare("insert or ignore into k values (?)"); for (const k of ks) i.run(k); return db.prepare("select * from results where key in (select key from k)").all().length; },
      close() { db.close(); },
    };
  },
  async pg() {
    const { default: pg } = await import(`${process.cwd()}/node_modules/pg/lib/index.js`);
    const c = new pg.Client({ host: "127.0.0.1", port: 55432, user: "postgres", password: "bench", database: "postgres" });
    await c.connect();
    await c.query("drop table if exists results");
    await c.query(`create table results(key text not null, project text not null, test_path text not null, kind text not null, full_name text not null,
      outcome text, duration_ms double precision, location_path text, location_line int, location_column int, commit_sha text, recorded_at bigint,
      primary key (key, project, test_path, kind, full_name))`);
    const put = async (rows) => {
      for (let i = 0; i < rows.length; i += 25000) {
        const part = rows.slice(i, i + 25000);
        await c.query(`insert into results select * from unnest($1::text[],$2::text[],$3::text[],$4::text[],$5::text[],$6::text[],$7::float8[],$8::text[],$9::int[],$10::int[],$11::text[],$12::bigint[]) on conflict do nothing`,
          COLS.map((col) => part.map((r) => r[col] ?? null)));
      }
    };
    return {
      preload: put, import: put,
      async clear(rows) { await c.query("delete from results where key = any($1::text[])", [[...new Set(rows.map((r) => r.key))]]); },
      async lookup(ks) { return (await c.query("select * from results where key = any($1::text[])", [ks])).rowCount; },
      async close() { await c.query("vacuum analyze results").catch(() => {}); await c.end(); },
    };
  },
  async valkey() {
    const { default: Valkey } = await import(`${process.cwd()}/node_modules/iovalkey/built/index.js`);
    const c = new Valkey({ host: "127.0.0.1", port: 56379, enableOfflineQueue: false, lazyConnect: true });
    await c.connect(); await c.flushall();
    const put = async (rows) => { const p = c.pipeline(); for (const [k, v] of byKey(rows)) p.set(`sq:${k}`, JSON.stringify(v), "NX"); await p.exec(); };
    return {
      preload: put, import: put,
      async clear(rows) { await c.del(...new Set(rows.map((r) => `sq:${r.key}`))); },
      async lookup(ks) { const vs = await c.mgetBuffer(...ks.map((k) => `sq:${k}`)); return vs.filter(Boolean).reduce((a, v) => a + JSON.parse(v).length, 0); },
      async close() { c.disconnect(); },
    };
  },
  async bazel() {
    const agent = new http.Agent({ keepAlive: true, maxSockets: Number(process.env.CONC ?? 16) });
    const req = (method, path, body) => new Promise((res, rej) => {
      const r = http.request({ host: "127.0.0.1", port: 58080, method, path, agent, headers: body ? { "content-length": body.length } : {} }, (s) => { const ch = []; s.on("data", (d) => ch.push(d)); s.on("end", () => res({ status: s.statusCode, body: Buffer.concat(ch) })); });
      r.on("error", rej); if (body) r.write(body); r.end();
    });
    const put = async (rows) => { const st = await Promise.all([...byKey(rows)].map(([k, v]) => req("PUT", `/ac/${k}`, Buffer.from(JSON.stringify(v))))); const bad = st.filter((s) => s.status >= 300); if (bad.length) throw new Error(`PUT ${bad[0].status} ${bad[0].body}`); };
    return {
      preload: put, import: put,
      async clear() { /* no delete in the HTTP API: the import keys are re-put; bazel-remote overwrites (see findings) */ },
      async lookup(ks) { const got = await Promise.all(ks.map((k) => req("GET", `/ac/${k}`))); return got.filter((g) => g.status === 200).reduce((a, g) => a + JSON.parse(g.body).length, 0); },
      async close() { agent.destroy(); },
    };
  },
};

const b = await backends[backend]();
let t = now(); await b.preload(preload); console.log(`${backend} preload ${preload.length} rows: ${ms(t).toFixed(0)} ms`);
const imports = [], lookups = [];
let found = 0;
for (let i = 0; i < repeats; i++) {
  await b.clear(imp);
  t = now(); await b.import(imp); imports.push(ms(t));
  t = now(); found = await b.lookup(keys); lookups.push(ms(t));
}
const impBytes = gzipSync(Buffer.from(JSON.stringify([...byKey(imp)]))).length;
report(`bulk import of ${imp.length} rows over ${new Set(imp.map((r) => r.key)).size} keys`, imports, `(payload ${(impBytes / 1024).toFixed(0)} KB gzip)`);
report(`batched lookup of ${keys.length} keys -> ${found} rows`, lookups, `(keys ${(keys.length * 65 / 1024).toFixed(0)} KB)`);
await b.close();
