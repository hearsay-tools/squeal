// Throwaway: compare derived with actual roots. node cmp_roots.mjs derived.json actual.json
import fs from "node:fs";
const [d, a] = process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
const ent = (x) => x.entries.map((e) => e.path);
const map = (x) => x.mappings.map((m) => `${m.name}=${m.path}`);
const de = ent(d), ae = ent(a), dm = map(d), am = map(a);
const sameSet = (x, y) => x.length === y.length && x.every((v) => y.includes(v));
const res = {
  entries_equal_in_order: JSON.stringify(de) === JSON.stringify(ae),
  entries_equal_as_set: sameSet([...new Set(de)], [...new Set(ae)]),
  mappings_equal: sameSet(dm, am),
  only_derived: [...de.filter((x) => !ae.includes(x)), ...dm.filter((x) => !am.includes(x))],
  only_actual: [...ae.filter((x) => !de.includes(x)), ...am.filter((x) => !dm.includes(x))],
  pth_names: d.entries.map((e, i) => `${e.pth}${a.entries[i] && a.entries[i].pth !== e.pth ? ` (actual ${a.entries[i].pth})` : ""}`),
  notes: d.notes,
};
console.log(JSON.stringify(res, null, 1));
