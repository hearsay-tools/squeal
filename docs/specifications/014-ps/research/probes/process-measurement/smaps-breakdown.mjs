// Throwaway probe for research 014-02: what /proc/<pid>/smaps (read-only) says about a large
// Node daemon's memory, by mapping kind, and what the read costs. Usage: node smaps-breakdown.mjs <pid>
import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
const pid = process.argv[2];
const c0 = process.cpuUsage(); const t0 = performance.now();
const text = readFileSync(`/proc/${pid}/smaps`, "latin1");
const wallMs = +(performance.now() - t0).toFixed(1); const c1 = process.cpuUsage(c0);
const kinds = {}; let cur = null;
for (const line of text.split("\n")) {
  const head = /^[0-9a-f]+-[0-9a-f]+ \S+ \S+ \S+ \S+\s*(.*)$/.exec(line);
  if (head) {
    const name = head[1].trim();
    const [a, b] = line.split(" ")[0].split("-").map((h) => parseInt(h, 16));
    const size = (b - a) / 1024;
    const kind = name === "" ? (size >= 1024 * 32 ? "anon >=32 MiB" : size >= 256 ? "anon 256 KiB-32 MiB" : "anon <256 KiB")
      : name.startsWith("[") ? name : /\.node$/.test(name) ? "native addon (.node)" : /\/node$/.test(name) ? "node binary" : /\.so/.test(name) ? "shared libs" : "other file";
    cur = kinds[kind] ??= { mappings: 0, rssKb: 0, privateKb: 0, swapKb: 0 };
    cur.mappings++;
  } else if (cur) {
    const m = /^(Rss|Private_Clean|Private_Dirty|Swap):\s+(\d+)/.exec(line);
    if (m) { if (m[1] === "Rss") cur.rssKb += +m[2]; else if (m[1] === "Swap") cur.swapKb += +m[2]; else cur.privateKb += +m[2]; }
  }
}
const rows = Object.entries(kinds).sort((a, b) => b[1].rssKb - a[1].rssKb).map(([k, v]) => ({ kind: k, mappings: v.mappings, rssMiB: +(v.rssKb / 1024).toFixed(1), privateMiB: +(v.privateKb / 1024).toFixed(1), swapMiB: +(v.swapKb / 1024).toFixed(1) }));
console.log(JSON.stringify({ pid, bytes: text.length, wallMs, cpuMs: +((c1.user + c1.system) / 1000).toFixed(1), status: Object.fromEntries(readFileSync(`/proc/${pid}/status`, "latin1").split("\n").filter((l) => /^(VmRSS|RssAnon|RssFile|VmData|VmSwap|Threads)/.test(l)).map((l) => l.split(/:\s+/))), rows }, null, 1));
