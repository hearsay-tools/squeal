// Row 011-180: for each line of yield.mjs, the named waits of its worktree issued at most 62 s before the run's end
// (`--wait 60000` deadlines), the files they select (a glob expanded over the store's test files), and whether they
// selected a cut file or a file of the next tier. Usage: node match.mjs <yield-*.jsonl> <waits.mjs output> <store copy>
// A worktree id is sha256 over its root, first 16 hex characters (src/core/fs/git-layout.ts); 8 are compared.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
const [, , yields, waitsFile, store] = process.argv;
const db = new DatabaseSync(store, { readOnly: true });
const paths = db.prepare("SELECT DISTINCT path FROM test_files").all().map((r) => r.path);
const idOf = (cwd0) => { const cwd = String(cwd0 ?? "").replace(/^file:\/\//, ""); const m = /^(.*\/\.ai\/cezar\/worktrees\/[0-9a-f-]{36})/.exec(cwd ?? ""); const root = m ? m[1] : (/^\/home\/agent\/projects\/[^/]+/.exec(cwd ?? "") ?? [""])[0]; return createHash("sha256").update(root).digest("hex").slice(0, 8); };
const waits = readFileSync(waitsFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).map((w) => ({ ...w, at: Date.parse(w.ts), wt: idOf(w.cwd) }));
const rx = (p) => new RegExp("^" + p.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*").replace(/\?/g, ".") + "$");
const expand = (w) => (w.set ??= new Set(w.paths.filter((p) => /^[\w.@/*?-]+$/.test(p)).flatMap((p) => { const r = rx(p); return paths.filter((x) => r.test(x)); })));
const runs = readFileSync(yields, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((o) => !o.summary);
const tally = { yields: 0, withWait: 0, cutNamed: 0, cutNamedFiles: 0, cutNamedHighS: 0, nextNamed: 0 };
for (const o of runs) {
  const end = Date.parse(o.start) + o.wall * 1000;
  const live = waits.filter((w) => w.wt === o.worktree && w.at >= end - 62_000 && w.at <= end + 1000);
  const named = new Set(live.flatMap((w) => [...expand(w)]));
  const cutNamed = o.cutFiles.filter((f) => named.has(f.file));
  const nextNamed = (o.next?.files ?? []).filter((f) => named.has(f));
  tally.yields++; if (live.length) tally.withWait++;
  if (cutNamed.length) { tally.cutNamed++; tally.cutNamedFiles += cutNamed.length; tally.cutNamedHighS += cutNamed.reduce((a, f) => a + f.highS, 0); }
  if (nextNamed.length) tally.nextNamed++;
  console.log(JSON.stringify({ run: o.run, worktree: o.worktree, waits: live.length, lastWaitBeforeEndS: live.length ? +((end - Math.max(...live.map((w) => w.at))) / 1000).toFixed(1) : null,
    named: named.size, cut: o.cutFiles.length, cutNamed: cutNamed.length, cutNamedHighS: +cutNamed.reduce((a, f) => a + f.highS, 0).toFixed(1), nextNamed: nextNamed.length }));
}
tally.cutNamedHighS = +tally.cutNamedHighS.toFixed(1);
console.log(JSON.stringify({ summary: true, ...tally }));
