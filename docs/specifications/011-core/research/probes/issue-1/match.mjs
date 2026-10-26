// Throwaway probe (row 011-249). Joins the signal-stop notes that notes.mjs
// printed with the cockpit's service stops, the Ansible restarts and the
// release tags. Usage:
//   node match.mjs <stops.txt> <ansible.txt> <tags.txt> <notes.jsonl>...
// stops.txt: "<UTC ISO> stop|oom|exit" per line; ansible.txt: "<UTC ISO>\tstate=..";
// tags.txt: "<ISO with offset> squeal--v<version>".
import { readFileSync } from "node:fs";
const [stopsFile, ansibleFile, tagsFile, ...noteFiles] = process.argv.slice(2);
const lines = (f) => readFileSync(f, "utf8").split("\n").filter(Boolean);
const utc = (s) => Date.parse(/Z|[+-]\d\d:\d\d$/.test(s) ? s : `${s}Z`);
const stops = lines(stopsFile).map((l) => { const [t, kind] = l.split(" "); return { at: utc(t), kind }; });
const ansible = lines(ansibleFile).map((l) => { const [t, s] = l.split("\t"); return { at: utc(t), state: s }; });
const tags = lines(tagsFile).map((l) => { const [t, ref] = l.split(" "); return { at: Date.parse(t), v: ref.replace("squeal--v", "") }; });
const near = (list, at) => list.reduce((b, x) => (b === null || Math.abs(x.at - at) < Math.abs(b.at - at) ? x : b), null);
const before = (list, at) => list.filter((x) => x.at <= at).at(-1) ?? null;
const after = (list, at) => list.find((x) => x.at > at) ?? null;
const fmt = (ms) => (ms === null ? "-" : Math.abs(ms) < 60_000 ? `${(ms / 1000).toFixed(2)} s` : `${(ms / 60_000).toFixed(1)} min`);
console.log("note (UTC) | store | worktree | rev | exited | nearest cockpit stop | Ansible restart before | tag before | tag after | next daemon");
for (const file of noteFiles) {
  const notes = lines(file).map((l) => JSON.parse(l)).filter((n) => n.at !== undefined);
  const byWt = Map.groupBy(notes, (n) => n.wt);
  for (const n of notes.filter((x) => x.text === "daemon stopped: signal").sort((a, b) => a.at - b.at)) {
    const s = near(stops, n.at);
    const a = before(ansible.filter((x) => x.state === "state=restarted"), n.at + 1000);
    const tb = before(tags, n.at), ta = after(tags, n.at);
    const exited = n.exitOf?.match(/^([^@]+)@(\d+)/);
    const next = (byWt.get(n.wt) ?? []).map((x) => x.exitOf?.match(/^([^@]+)@(\d+)/)).filter((m) => m && Number(m[2]) > n.at)
      .sort((x, y) => Number(x[2]) - Number(y[2]))[0];
    console.log([n.iso, file.replace(/.*\//, "").replace(".jsonl", ""), n.wt.slice(0, 8), n.revision ?? "-",
      exited ? `${exited[1]} (age ${fmt(n.at - Number(exited[2]))})` : "-",
      s ? `${s.kind} ${fmt(n.at - s.at)}` : "-", a ? fmt(n.at - a.at) : "-",
      tb ? `${tb.v} ${fmt(n.at - tb.at)} before` : "-", ta ? `${ta.v} ${fmt(ta.at - n.at)} after` : "-",
      next ? `${next[1]} ${fmt(Number(next[2]) - n.at)} later` : "-"].join(" | "));
  }
}
