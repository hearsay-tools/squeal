import { DatabaseSync } from "node:sqlite";
const d = new DatabaseSync(process.argv[2], { readOnly: true });
const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;
for (const { key, value } of d.prepare("select key, value from meta where key like 'observed.%'").all()) {
  const m = JSON.parse(value); let tests = 0, entries = 0, json = 0, abs = 0, uu = 0; const top = [];
  for (const [t, ps] of Object.entries(m)) { tests++; entries += ps.length; const j = ps.filter(p => p.startsWith("{")).length, a = ps.filter(p => p.startsWith("/")).length, u = ps.filter(p => !p.startsWith("{") && uuid.test(p)).length; json += j; abs += a; uu += u; if (j + u > 0) top.push([t, ps.length, j, u]); }
  console.log(key, { tests, entries, jsonSpawnEntries: json, absolutePaths: abs, uuidPathEntries: uu, testsAffected: top.length });
  top.sort((x, y) => y[1] - x[1]).slice(0, 8).forEach(r => console.log("  ", r.join(" ")));
}
