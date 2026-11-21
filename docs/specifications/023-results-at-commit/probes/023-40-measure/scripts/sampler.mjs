// Samples, every 200 ms until killed: each Squeal daemon's process tree (RSS, PSS),
// the commit worktree's phases (folder, installed, claimed) and the named file's
// result in the store. Writes JSON lines to argv[2].
// Usage: node sampler.mjs <out.jsonl> <repo root> <test file>
import { appendFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

const [out, repo, file] = process.argv.slice(2);
const cache = join(process.env.HOME, ".cache/squeal/checkouts");
const write = (o) => appendFileSync(out, JSON.stringify({ t: Date.now(), ...o }) + "\n");

function procs() {
  const list = [];
  for (const d of readdirSync("/proc")) {
    if (!/^\d+$/.test(d)) continue;
    try {
      const status = readFileSync(`/proc/${d}/status`, "utf8");
      const ppid = Number(/PPid:\s+(\d+)/.exec(status)[1]);
      const rss = Number(/VmRSS:\s+(\d+)/.exec(status)?.[1] ?? 0);
      const cmd = readFileSync(`/proc/${d}/cmdline`, "utf8").split("\0").join(" ");
      list.push({ pid: Number(d), ppid, rss, cmd });
    } catch {}
  }
  return list;
}
function pss(pid) {
  try {
    const t = readFileSync(`/proc/${pid}/smaps_rollup`, "utf8");
    return Number(/Pss:\s+(\d+)/.exec(t)?.[1] ?? 0);
  } catch {
    return 0;
  }
}
const seen = {};
function event(name, extra = {}) {
  if (seen[name]) return;
  seen[name] = true;
  write({ event: name, ...extra });
}
let db = null;
let n = 0;
for (;;) {
  n++;
  const all = procs();
  const kids = new Map();
  for (const p of all) (kids.get(p.ppid) ?? kids.set(p.ppid, []).get(p.ppid)).push(p);
  const daemons = all.filter((p) => / daemon \//.test(p.cmd) && p.cmd.includes("squeal.mjs"));
  const trees = [];
  for (const d of daemons) {
    const root = d.cmd.split(" daemon ")[1]?.split(" ")[0] ?? "?";
    const kind = root.includes("/commit-") ? "commit" : "worktree";
    const members = [];
    const stack = [d];
    while (stack.length) {
      const p = stack.pop();
      members.push(p);
      stack.push(...(kids.get(p.pid) ?? []));
    }
    const withPss = members.map((m) => ({ pid: m.pid, rss: m.rss, pss: pss(m.pid), role: role(m.cmd) }));
    trees.push({
      pid: d.pid,
      kind,
      commit: /commit-([0-9a-f]{9})/.exec(root)?.[1] ?? null,
      rssKb: withPss.reduce((a, m) => a + m.rss, 0),
      pssKb: withPss.reduce((a, m) => a + m.pss, 0),
      daemonRssKb: withPss[0].rss,
      daemonPssKb: withPss[0].pss,
      members: withPss.length,
      roles: summarize(withPss),
    });
    event(`daemon-process:${kind}:${d.pid}`, { root });
  }
  const mem = readFileSync("/proc/meminfo", "utf8");
  const avail = Number(/MemAvailable:\s+(\d+)/.exec(mem)[1]);
  const load = readFileSync("/proc/loadavg", "utf8").split(" ")[0];
  write({ trees, availKb: avail, load: Number(load) });

  // Commit worktree phases.
  try {
    for (const repoDir of existsSync(cache) ? readdirSync(cache) : []) {
      const dir = join(cache, repoDir);
      if (!existsSync(dir) || repoDir.startsWith("commit-places")) continue;
      for (const f of readdirSync(dir)) {
        if (!f.startsWith("commit-")) continue;
        const c = f.slice(7, 16);
        event(`folder:${c}`);
        try {
          const m = JSON.parse(readFileSync(join(dir, f, "marker.json"), "utf8"));
          if (m.installed) event(`installed:${c}`);
          if (m.daemon) event(`claimed:${c}`, { pid: m.daemon.pid });
        } catch {}
      }
    }
  } catch {}
  // The named file's results in the store, once a second.
  if (n % 5 === 0) {
    try {
      db ??= new DatabaseSync(join(repo, ".git/squeal/store.sqlite"), { readOnly: true });
      const rows = db
        .prepare(
          "select distinct r.worktree_id as w, r.commit_sha as c, min(r.recorded_at) as at, r.key as key from results r where r.location_path = ? or r.key in (select key from test_file_keys where path = ?) group by r.worktree_id, r.key",
        )
        .all(file, file);
      for (const r of rows) event(`result:${r.w}:${String(r.c).slice(0, 9)}`, { at: Number(r.at), key: r.key.slice(0, 12) });
    } catch {
      db = null;
    }
  }
  await new Promise((r) => setTimeout(r, 200));
}

function role(cmd) {
  if (cmd.includes("runner-host")) return "runner-host";
  if (cmd.includes("store-process")) return "store";
  if (cmd.includes("vitest") || cmd.includes("worker")) return "worker";
  if (/ daemon \//.test(cmd)) return "daemon";
  return cmd.split(" ")[0].split("/").pop();
}
function summarize(ms) {
  const o = {};
  for (const m of ms) {
    o[m.role] ??= { n: 0, rssKb: 0, pssKb: 0 };
    o[m.role].n++;
    o[m.role].rssKb += m.rss;
    o[m.role].pssKb += m.pss;
  }
  return o;
}
