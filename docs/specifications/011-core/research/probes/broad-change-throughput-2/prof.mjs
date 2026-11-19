// prof.mjs <prof dir> <clock file> <edits.tsv> <procs.txt>: question 2's
// phases from the V8 CPU profiles of the daemon and its runner hosts
// (`node --cpu-prof`, q2.sh). For each revision's window, its edit to the
// moment it was seen refined, and for each profiled process with samples in
// it: wall s, sampled s that were not idle, and inclusive s of each named
// function of the runner part (any frame of the sample's stack with that
// name; a sample counts once per name), plus the top self-time functions.
// The clock file holds epoch ms and CLOCK_MONOTONIC us read at one instant;
// V8's profile timestamps are CLOCK_MONOTONIC us on Linux.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
const [dir, clockFile, editsFile, procsFile] = process.argv.slice(2);
const [epochMs, monoUs] = readFileSync(clockFile, "utf8").trim().split(/\s+/).map(Number);
const toMono = (ms) => monoUs + (ms - epochMs) * 1000;
const roles = new Map(readFileSync(procsFile, "utf8").trim().split("\n").map((l) => {
  const [pid, , ...args] = l.trim().split(/\s+/);
  const a = args.join(" ");
  return [pid, /runner-host/.test(a) ? `runner-host ${/--runner (\S+)/.exec(a)?.[1] ?? ""}` : "daemon"];
}));
const windows = readFileSync(editsFile, "utf8").trim().split("\n").map((l) => {
  const [t, label, path, rev, end, run, queued] = l.split("\t");
  return { label, path, rev, queued: Number(queued), from: toMono(Number(t)), to: end === "-" ? toMono(Number(t) + 300000) : toMono(Number(end)), wallS: end === "-" ? null : (Number(end) - Number(t)) / 1000 };
});
// The runner part's functions (Squeal 0.1.563 source names, kept in its bundle).
const NAMED = [
  "fetchRunnerPart", "applyRunnerPart", "applyRefinement", "rekeyContent", "invalidate", "testFiles", "globTestSpecifications",
  "affected", "affectedTestFiles", "askAffected", "closure", "importClosure", "resolutionInputs", "moduleGlobs", "fileImports",
  "missingCandidates", "closurePackages", "fetchEditCut", "editWork", "setClosure", "settle", "storeClosures", "bindWalks",
  "trackUntracked", "regrowObserved", "regrowStartup", "setEnvironments", "quietQueued", "quietCaughtUp", "demote",
  "transformRequest", "fetchModule", "parseAst", "readHash", "transaction", "parse", "stringify", "(garbage collector)",
];
const out = [];
for (const f of readdirSync(dir).filter((f) => f.endsWith(".cpuprofile"))) {
  const pid = /CPU\.\d+\.\d+\.(\d+)\.(\d+)\./.exec(f);
  const prof = JSON.parse(readFileSync(join(dir, f), "utf8"));
  const byId = new Map(prof.nodes.map((n) => [n.id, n]));
  const parent = new Map();
  for (const n of prof.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const stackNames = new Map();
  const namesOf = (id) => {
    let s = stackNames.get(id);
    if (s) return s;
    s = new Set();
    for (let x = id; x !== undefined; x = parent.get(x)) s.add(byId.get(x).callFrame.functionName || "(anonymous)");
    stackNames.set(id, s);
    return s;
  };
  let t = prof.startTime;
  const times = prof.timeDeltas.map((d) => (t += d));
  for (const w of windows) {
    let total = 0, idle = 0;
    const incl = new Map(), self = new Map();
    for (let i = 0; i < prof.samples.length; i++) {
      if (times[i] < w.from || times[i] > w.to) continue;
      const dt = (prof.timeDeltas[i + 1] ?? 0) / 1e6;
      const node = byId.get(prof.samples[i]);
      const name = node.callFrame.functionName || "(anonymous)";
      total += dt;
      if (name === "(idle)" || name === "(program)") { idle += dt; continue; }
      const key = `${name} ${node.callFrame.url.split("/").slice(-2).join("/")}:${node.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + dt);
      for (const n of namesOf(node.id)) if (NAMED.includes(n)) incl.set(n, (incl.get(n) ?? 0) + dt);
    }
    if (total === 0) continue;
    const r1 = (x) => +x.toFixed(2);
    out.push({ window: w.label, rev: w.rev, wallS: w.wallS, queued: w.queued, file: f, process: roles.get(pid?.[1]) ?? `pid ${pid?.[1]} thread ${pid?.[2]}`,
      sampledS: r1(total), busyS: r1(total - idle),
      inclusiveS: Object.fromEntries([...incl].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, r1(v)])),
      topSelfS: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([k, v]) => [k, r1(v)]) });
  }
}
console.log(JSON.stringify(out, null, 1));
