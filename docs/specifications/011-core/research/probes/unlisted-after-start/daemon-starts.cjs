// Throwaway probe (011-385). Reads Squeal daemon logs (read-only) and prints one JSON line per
// daemon process (pid) in each log: root, first line, the listing commit (`commitFirst` long
// write, else the first `Ledger.commit` long write before `serving`), `serving`, the store-busy
// waits logged before `serving`, and the long writes before `serving`.
// Usage: node daemon-starts.cjs <logs-dir> [since-ISO]
const fs = require("fs"), path = require("path");
const [dir, since = "2026-11-10"] = process.argv.slice(2);
const re = /^(\S+) \[(\d+)\] squeal daemon: (.*)$/;
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith(".log")) continue;
  const byPid = new Map();
  for (const line of fs.readFileSync(path.join(dir, name), "utf8").split("\n")) {
    const m = re.exec(line); if (!m) continue;
    const [, ts, pid, text] = m; if (ts < since) continue;
    if (text.startsWith("another daemon serves")) continue;
    let d = byPid.get(pid);
    if (!d) { d = { log: name, pid, first: ts, busyBefore: [], writesBefore: [] }; byPid.set(pid, d); }
    d.last = ts;
    if (!d.serving) {
      const s = /^serving (\S+) on /.exec(text);
      if (s) { d.serving = ts; d.root = s[1]; continue; }
      const b = /^the store was busy for ([\d.]+) s .*ran once it was free: (.*)$/.exec(text);
      if (b) d.busyBefore.push({ ts, s: Number(b[1]), what: b[2] });
      const w = /^long write: (\S+) write lock held (\d+) ms by (.*?); (\d+) rows written/.exec(text);
      if (w) {
        d.writesBefore.push({ ts, db: w[1], ms: Number(w[2]), by: w[3], rows: Number(w[4]) });
        if (!d.listed && /commitFirst/.test(w[3])) d.listed = { ts, ms: Number(w[2]), rows: Number(w[4]), via: "commitFirst" };
        if (!d.listed && /Ledger\.commit/.test(w[3]) && w[1] === "store.sqlite") d.listed = { ts, ms: Number(w[2]), rows: Number(w[4]), via: "commit" };
      }
      if (/quick_check|integrity/.test(text)) (d.check ??= []).push({ ts, text: text.slice(0, 120) });
    } else {
      const st = /^daemon stopped: (.*)$/.exec(text); if (st && !d.stopped) d.stopped = { ts, why: st[1].slice(0, 80) };
    }
  }
  for (const d of byPid.values()) console.log(JSON.stringify(d));
}
