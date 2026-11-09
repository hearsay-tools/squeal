import { DatabaseSync } from "node:sqlite";
const A = new DatabaseSync("cez-1/.git/squeal/store.sqlite", { readOnly: true }), B = new DatabaseSync("cez-2/.git/squeal/store.sqlite", { readOnly: true });
const f = "packages/cezar/src/artifacts/cli.test.ts";
const cl = (db) => JSON.parse(db.prepare("select closure_paths c from test_files where project='server' and path=?").get(f).c);
const extra = cl(B).filter((p) => !new Set(cl(A)).has(p));
const obs = (db) => { const s = new Set(); for (const k of ["observed.server", "observedDirect.server", "observedModules.server"]) { const v = db.prepare("select value from meta where key=?").get(k)?.value; if (!v) continue; for (const p of [].concat(JSON.parse(v)[f] ?? [])) s.add(p); } return s; };
const oa = obs(A), ob = obs(B);
console.log("extra in shared closure:", extra.length, "of which in CI observed:", extra.filter((p) => oa.has(p)).length, "in shared observed:", extra.filter((p) => ob.has(p)).length);
console.log("CI observed size", oa.size, "shared observed size", ob.size, "sample extra:", extra.slice(0, 6));
