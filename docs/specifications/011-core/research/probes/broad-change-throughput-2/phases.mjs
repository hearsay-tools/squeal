// phases.mjs <clock> <edits.tsv> <profile>...: per window, per tag, first and last sample (s after the edit) and busy s
import { readFileSync } from "node:fs";
const [clockFile, editsFile, ...pfs] = process.argv.slice(2);
const [epochMs, monoUs] = readFileSync(clockFile, "utf8").trim().split(/\s+/).map(Number);
const toMono = (ms) => monoUs + (ms - epochMs) * 1000;
const TAGS = { closure: /^\(anon\)@squeal\.mjs:30377$/, affected: /^affectedTestFiles@/, rekey: /^rekeyContent@/, apply: /^applyRunnerPart@/, fetch: /^fetchRunnerPart@/,
  storeClosures: /^storeClosures@/, editCut: /^fetchEditCut@/, glob: /^globTestSpecifications@/, testFiles: /^testFiles@/, invalidate: /^invalidate@/, vitestRun: /^runFiles@|^runTestSpecifications@/, ssr: /^ssrTransformScript@/ };
const profs = pfs.map((pf) => { const p = JSON.parse(readFileSync(pf, "utf8")); const byId = new Map(p.nodes.map((n) => [n.id, n])); const parent = new Map();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id); let t = p.startTime; return { pf, p, byId, parent, times: p.timeDeltas.map((d) => (t += d)) }; });
const nm = (n) => `${n.callFrame.functionName || "(anon)"}@${n.callFrame.url.split("/").pop()}:${n.callFrame.lineNumber + 1}`;
for (const l of readFileSync(editsFile, "utf8").trim().split("\n")) {
  const [ts, label, , , end] = l.split("\t"); const from = toMono(+ts), to = end === "-" ? toMono(+ts + 30000) : toMono(+end);
  console.log(`\n## ${label} wall ${end === "-" ? "-" : ((+end - +ts) / 1000).toFixed(1)}`);
  for (const { pf, p, byId, parent, times } of profs) {
    const acc = {};
    for (let i = 0; i < p.samples.length; i++) {
      if (times[i] < from || times[i] > to) continue; const dt = (p.timeDeltas[i + 1] ?? 0) / 1e6; const s = (times[i] - from) / 1e6;
      const names = new Set(); for (let x = p.samples[i]; x !== undefined; x = parent.get(x)) names.add(nm(byId.get(x)));
      for (const [tag, re] of Object.entries(TAGS)) if ([...names].some((n) => re.test(n))) { const a = (acc[tag] ??= { first: s, last: s, busy: 0 }); a.last = s; a.busy += dt; }
    }
    const who = pf.split(".")[3];
    console.log(" ", who, Object.entries(acc).map(([k, v]) => `${k} ${v.first.toFixed(1)}-${v.last.toFixed(1)}s busy ${v.busy.toFixed(2)}`).join(" | "));
  }
}
