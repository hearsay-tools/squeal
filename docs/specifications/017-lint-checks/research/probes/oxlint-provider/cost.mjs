// Q3 (throwaway): CPU, wall time and peak RSS of a fresh `oxlint --format json`
// per run, through GNU time (user + sys of oxlint and every child it waited
// for, tsgolint included; 10 ms resolution). Cases are interleaved round by
// round, each run at nice 10, with the one-minute load recorded.
// Usage: node cost.mjs <project> <oxlint bin> <rounds> <out.json> <case>...
//   case = name=config.json:threads:file1,file2,...   (files "-" = whole project)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [project, ox, roundsArg, outFile, ...caseArgs] = process.argv.slice(2);
const cases = caseArgs.map((c) => {
  const [name, rest] = c.split("=");
  const [config, threads, files] = rest.split(":");
  return { name, config, threads, files: files === "-" ? [] : files.split(",") };
});
const timeOut = path.join(os.tmpdir(), `oxcost-${process.pid}.txt`);
const rows = [];
for (let r = 0; r < Number(roundsArg); r++) {
  for (const c of cases) {
    const args = ["--format", "json", "-c", c.config, ...(c.threads === "d" ? [] : ["--threads", c.threads]), ...c.files];
    const load = os.loadavg()[0];
    const res = spawnSync("/usr/bin/time", ["-f", "%U %S %M %e", "-o", timeOut, "nice", "-n", "10", process.execPath, ox, ...args], { cwd: project, encoding: "utf8", maxBuffer: 256 << 20, env: process.env });
    const [u, s, rss, wall] = fs.readFileSync(timeOut, "utf8").trim().split("\n").pop().split(" ").map(Number);
    let n = null, files = null;
    try { const j = JSON.parse(res.stdout); n = j.diagnostics.length; files = j.number_of_files; } catch {}
    rows.push({ round: r, case: c.name, cpuMs: Math.round((u + s) * 1000), userMs: Math.round(u * 1000), sysMs: Math.round(s * 1000), wallMs: Math.round(wall * 1000), rssMB: Math.round(rss / 1024), files, findings: n, load });
  }
}
fs.rmSync(timeOut, { force: true });
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const summary = cases.map((c) => {
  const rs = rows.filter((x) => x.case === c.name);
  const f = (k) => `${med(rs.map((x) => x[k]))} [${Math.min(...rs.map((x) => x[k]))}–${Math.max(...rs.map((x) => x[k]))}]`;
  return { case: c.name, n: rs.length, files: rs[0].files, findings: rs[0].findings, cpuMs: f("cpuMs"), sysMs: f("sysMs"), wallMs: f("wallMs"), rssMB: f("rssMB"), load: `${Math.min(...rs.map((x) => x.load)).toFixed(1)}–${Math.max(...rs.map((x) => x.load)).toFixed(1)}` };
});
fs.writeFileSync(outFile, JSON.stringify({ project, cases, summary, rows }, null, 1));
console.table(summary);
