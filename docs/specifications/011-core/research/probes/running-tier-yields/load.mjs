// The host's one-minute load (sysstat `sar -q`, 10 min samples, local time = UTC+2) nearest each time.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
const samples = [];
for (const day of ["14", "15", "16", "17", "18", "19", "20", "21"]) {
  let out = "";
  try { out = execFileSync("sar", ["-q", "-f", `/var/log/sysstat/sa${day}`], { env: { ...process.env, LC_ALL: "C" } }).toString(); } catch { continue; }
  for (const line of out.split("\n")) {
    const m = /^(\d\d):(\d\d):(\d\d)\s+\d+\s+\d+\s+([\d.]+)/.exec(line);
    if (m) samples.push({ t: Date.parse(`2026-10-${day}T${m[1]}:${m[2]}:${m[3]}+02:00`), l1: +m[4] });
  }
}
const at = (t) => samples.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a)).l1;
const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const cancels = JSON.parse(readFileSync("/tmp/r381/cancels.json", "utf8")).map((c) => at(Date.parse(c.startedAt)));
const mt = JSON.parse(readFileSync("/tmp/r381/mid-tier.json", "utf8"));
const eps = mt.episodes.map((e) => at(Date.parse(e.at)));
const revs = mt.revEvents.map((v) => at(Date.parse(v.at)));
const fmt = (xs) => `p10 ${q(xs, 0.1)}, p50 ${q(xs, 0.5)}, p90 ${q(xs, 0.9)}, below 8: ${xs.filter((x) => x < 8).length} of ${xs.length}`;
console.log(`samples ${samples.length}; load at the recorded cancels: ${fmt(cancels)}`);
console.log(`load at the named-wait episodes: ${fmt(eps)}`);
console.log(`load at the mid-tier revisions: ${fmt(revs)}`);
for (const t of ["2026-10-21T07:04:19Z", "2026-10-21T07:12:46Z", "2026-10-21T07:33:39Z"]) console.log(t, at(Date.parse(t)));
