// Summarises one out dir of run.sh: per rep phase times and the commit daemon's memory.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
const dir = process.argv[2];
const MiB = (kb) => Math.round(kb / 1024);
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
const TIP = process.env.TIP ?? "dd245530e";
const reps = readdirSync(dir).filter((f) => f.endsWith(".times.json") && !f.startsWith("prof")).map((f) => f.replace(".times.json", ""));
const rows = [];
for (const label of reps.sort()) {
  const t = JSON.parse(readFileSync(join(dir, `${label}.times.json`), "utf8"));
  const lines = readFileSync(join(dir, `${label}.samples.jsonl`), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  const ev = Object.fromEntries(lines.filter((l) => l.event).map((l) => [l.event.replace(/:[0-9a-f]{9}$/, ""), l]));
  const evs = lines.filter((l) => l.event);
  const claimed = evs.find((e) => e.event.startsWith("claimed:"));
  const cpid = claimed?.pid;
  const commitResult = evs.find((e) => e.event.startsWith("result:") && !e.event.endsWith(TIP));
  const wtResult = evs.find((e) => e.event.startsWith("result:") && e.event.endsWith(TIP));
  const out = readFileSync(join(dir, `${label}.call.out`), "utf8");
  const out2 = existsSync(join(dir, `${label}.call2.out`)) ? readFileSync(join(dir, `${label}.call2.out`), "utf8") : "";
  // The named file's line at the commit side, as the call printed it.
  const verdict = (o) => o.split("\n").filter((l) => /pass -> fail|^--run:|setting up|not determined|commit-removal/.test(l)).map((l) => l.replace(/ \(its worktree [^)]*\)/, "").trim().slice(0, 140)).join(" | ");
  const proc = evs.find((e) => e.event.startsWith("daemon-process:") && e.event.endsWith(`:${cpid}`));
  const spawn = proc?.spawnedAt ?? proc?.t;
  const logs = join(dir, `${label}.logs`);
  let serving = null, wtServing = null, firstLine = null;
  if (existsSync(logs)) for (const f of readdirSync(logs)) {
    for (const l of readFileSync(join(logs, f), "utf8").split("\n")) {
      const m = /^(\S+Z) \[(\d+)\] squeal daemon: serving (\S+)/.exec(l);
      if (!m) continue;
      const at = Date.parse(m[1]);
      if (Number(m[2]) === cpid) serving = at; else if (at <= t.t1 + 60000) wtServing = at;
    }
  }
  const rel = (x) => (x == null ? null : +((x - t.t0) / 1000).toFixed(1));
  // Memory of the commit daemon's tree.
  const mem = lines.filter((l) => l.trees).map((l) => ({ t: l.t, tree: l.trees.find((x) => x.pid === cpid), load: l.load, avail: l.availKb }));
  const withTree = mem.filter((m) => m.tree);
  const peak = (arr, k) => Math.max(0, ...arr.map((m) => m.tree[k]));
  const resAt = Math.max(commitResult?.at ?? t.t1, t.t3 ?? 0);
  const idleEnd = t.g0 ?? t.s0;
  const idle = withTree.filter((m) => m.t > resAt + 5000 && m.t < idleEnd);
  const group = t.g0 ? withTree.filter((m) => m.t >= t.g0 && m.t <= t.g1 + 2000) : [];
  const start = withTree.filter((m) => m.t <= (serving ?? resAt));
  rows.push({
    label, call: rel(t.t1), exit: t.code, verdict: verdict(out),
    call2: t.t3 ? +((t.t3 - t.t2) / 1000).toFixed(1) : null, exit2: t.code2, verdict2: verdict(out2),
    spawn: rel(spawn), spawnToClaim: claimed && spawn ? +((claimed.t - spawn) / 1000).toFixed(1) : null,
    spawnToServing: serving && spawn ? +((serving - spawn) / 1000).toFixed(1) : null,
    spawnToResult: commitResult && spawn ? +((commitResult.at - spawn) / 1000).toFixed(1) : null,
    folder: rel(ev.folder?.t), install: ev.installed && ev.folder ? +((ev.installed.t - ev.folder.t) / 1000).toFixed(1) : null,
    claimed: rel(claimed?.t), serving: rel(serving), startToServing: serving && claimed ? +((serving - claimed.t) / 1000).toFixed(1) : null,
    wtServing: rel(wtServing), commitResult: rel(commitResult?.at), afterServing: commitResult && serving ? +((commitResult.at - serving) / 1000).toFixed(1) : null,
    wtResult: rel(wtResult?.at), group: t.g0 ? +((t.g1 - t.g0) / 1000).toFixed(1) : null, gcode: t.gcode,
    stop: +((t.s1 - t.s0) / 1000).toFixed(1), gone: +((t.s2 - t.s0) / 1000).toFixed(1), treeLeft: t.treeLeft,
    startPeakRss: MiB(peak(start, "rssKb")), startPeakPss: MiB(peak(start, "pssKb")),
    peakRss: MiB(peak(withTree, "rssKb")), peakPss: MiB(peak(withTree, "pssKb")), peakDaemonRss: MiB(peak(withTree, "daemonRssKb")),
    idleRss: MiB(med(idle.map((m) => m.tree.rssKb)) ?? 0), idlePss: MiB(med(idle.map((m) => m.tree.pssKb)) ?? 0), idleDaemonRss: MiB(med(idle.map((m) => m.tree.daemonRssKb)) ?? 0),
    idleLastRss: idle.length ? MiB(idle.at(-1).tree.rssKb) : null,
    groupPeakRss: group.length ? MiB(peak(group, "rssKb")) : null, groupPeakPss: group.length ? MiB(peak(group, "pssKb")) : null,
    groupPeakMembers: group.length ? Math.max(...group.map((m) => m.tree.members)) : null,
    idleRoles: idle.length ? Object.fromEntries(Object.entries(idle.at(-1).tree.roles).map(([k, v]) => [k, `${v.n}:${MiB(v.rssKb)}/${MiB(v.pssKb)}`])) : null,
    maxLoad: Math.max(...mem.map((m) => m.load)),
  });
}
console.log(JSON.stringify(rows, null, 1));
