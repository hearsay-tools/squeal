// Probe 023-81: per listed folder, the names that came or went across the pass, and who wrote below each name.
const [snapF, t0F, t1F, writesF, decF] = process.argv.slice(2);
const snap = require(snapF), t0 = require(t0F), t1 = require(t1F), writes = require(writesF);
const fs = require("node:fs");
const dirs = Object.keys(snap.names);
const readers = {};
for (const [t, ls] of Object.entries(snap.observed)) for (const d of ls) (readers[d] ??= []).push(t);
const short = (c) => c.startsWith("squeal") ? c : c.startsWith("other:uv") ? "uv (test child)" : c.startsWith("other:sh") ? "sh (test child)" : c.startsWith("other:git") || c.startsWith("other:/usr/bin/git") ? "git (test child)" : /^other:\S*node/.test(c) ? "node (test process)" : c.includes("pytest") || c.includes("-m app") ? "python (test child)" : c.slice(0, 40);
const rows = [];
for (const d of dirs) {
  const base = d === "./" ? "" : d;
  const before = new Set(t0[d] ?? []), after = new Set(t1[d] ?? []);
  const touched = new Map();
  for (const w of writes) {
    if (!(base === "" || w.path.startsWith(base))) continue;
    const rest = base === "" ? w.path : w.path.slice(base.length);
    if (rest === "") continue;
    const name = rest.split("/")[0];
    const e = touched.get(name) ?? { kinds: new Set(), cls: new Set(), direct: false };
    e.kinds.add(w.call); e.cls.add(short(w.cls)); if (!rest.includes("/")) e.direct = true;
    touched.set(name, e);
  }
  const added = [...after].filter((n) => !before.has(n));
  const removed = [...before].filter((n) => !after.has(n));
  const transient = [...touched].filter(([n, e]) => e.direct && !before.has(n) && !after.has(n)).map(([n]) => n);
  if (added.length + removed.length + transient.length === 0) continue;
  rows.push({ dir: d, readers: readers[d]?.length ?? 0, readerSample: (readers[d] ?? []).slice(0, 3),
    added: added.map((n) => [n, [...(touched.get(n)?.cls ?? ["no write seen"])].join("+")]),
    removed: removed.map((n) => [n, [...(touched.get(n)?.cls ?? ["no write seen"])].join("+")]),
    transient: transient.slice(0, 5).map((n) => [n, [...touched.get(n).cls].join("+")]), transientCount: transient.length });
}
console.log(JSON.stringify(rows, null, 1));
