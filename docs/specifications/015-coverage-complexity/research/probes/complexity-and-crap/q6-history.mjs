// Throwaway probe (015-02), Q6 and the "code can squeal" reading: replay the last N commits that touch
// src/*.ts, count CC per function before and after, and measure identity stability and threshold transitions.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { viaTreeSitter } from "./engines.mjs";
const [repo, nArg] = process.argv.slice(2);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 28 });
const commits = git("log", "--no-merges", "--format=%H", "-n", nArg ?? "200", "--", "src/*.ts").trim().split("\n");
const T = [10, 20];
const isAnon = (name) => name.split(".").at(-1).startsWith("<");
const blobCache = new Map(); let parseMs = 0, parsed = 0;
function fnsAt(rev, path) {
  let blob; try { blob = git("rev-parse", `${rev}:${path}`).trim(); } catch { return null; }
  if (blobCache.has(blob)) return blobCache.get(blob);
  const src = git("cat-file", "blob", blob);
  const t = performance.now();
  const { fns } = viaTreeSitter(path, src);
  parseMs += performance.now() - t; parsed++;
  const lines = src.split("\n");
  for (const f of fns) f.hash = createHash("sha1").update(lines.slice(f.line - 1, f.endLine).join("\n").replace(/\s+/g, " ")).digest("hex").slice(0, 12);
  blobCache.set(blob, fns);
  return fns;
}
const tot = { commits: 0, files: 0, fnsAfter: 0, ccChanged: 0, bodyChangedSameCc: 0, unchanged: 0, born: 0, died: 0,
  renamedSameBody: 0, dupNamesAfter: 0, anonFns: 0, anonIndexShift: 0, crossUp: { 10: 0, 20: 0 }, crossDown: { 10: 0, 20: 0 }, bornAbove: { 10: 0, 20: 0 },
  commitsWithAnyTransition10: 0, bornAnon: 0, diedAnon: 0, bornInNewFiles: 0, commitsWithAnyTransition20: 0 };
const perCommit10 = [];
for (const c of commits) {
  let parent; try { parent = git("rev-parse", `${c}^`).trim(); } catch { continue; }
  const changes = git("diff", "--name-status", "-M", parent, c, "--", "src").trim().split("\n").filter(Boolean)
    .map((l) => l.split("\t")).filter((p) => /\.(ts|tsx|mjs|cjs)$/.test(p.at(-1)) && !p.at(-1).endsWith(".d.ts"));
  if (!changes.length) continue;
  tot.commits++; let tr10 = 0, tr20 = 0;
  for (const ch of changes) {
    const status = ch[0]; const before = status.startsWith("R") ? ch[1] : ch[1]; const after = ch.at(-1);
    const a = status === "A" ? [] : fnsAt(parent, before) ?? []; const b = status === "D" ? [] : fnsAt(c, after) ?? [];
    tot.files++; tot.fnsAfter += b.length;
    const count = (xs) => { const m = new Map(); for (const f of xs) m.set(f.name, (m.get(f.name) ?? 0) + 1); return m; };
    const nb = count(b); for (const v of nb.values()) if (v > 1) tot.dupNamesAfter += v;
    const byName = new Map(a.map((f) => [f.name, f]));
    const aHashes = new Map(a.map((f) => [f.hash, f])); const bNames = new Set(b.map((f) => f.name));
    for (const f of b) {
      if (isAnon(f.name)) tot.anonFns++;
      const old = byName.get(f.name);
      if (!old) {
        const same = aHashes.get(f.hash);
        if (same && !bNames.has(same.name)) { tot.renamedSameBody++; if (isAnon(same.name) && isAnon(f.name)) tot.anonIndexShift++; continue; }
        tot.born++; if (status === "A") tot.bornInNewFiles++; if (isAnon(f.name)) tot.bornAnon++; for (const t of T) if (f.cc >= t) tot.bornAbove[t]++; continue;
      }
      if (old.hash === f.hash) tot.unchanged++; else if (old.cc === f.cc) tot.bodyChangedSameCc++; else tot.ccChanged++;
      for (const t of T) {
        if (old.cc < t && f.cc >= t) { tot.crossUp[t]++; t === 10 ? tr10++ : tr20++; }
        if (old.cc >= t && f.cc < t) { tot.crossDown[t]++; t === 10 ? tr10++ : tr20++; }
      }
    }
    for (const f of a) if (!nb.has(f.name) && !b.some((x) => x.hash === f.hash)) { tot.died++; if (isAnon(f.name)) tot.diedAnon++; }
  }
  if (tr10) tot.commitsWithAnyTransition10++; if (tr20) tot.commitsWithAnyTransition20++;
  perCommit10.push(tr10);
}
console.log(JSON.stringify({ range: git("log", "-1", "--format=%cs", commits.at(-1)).trim() + ".." + git("log", "-1", "--format=%cs", commits[0]).trim(), ...tot, parsedBlobs: parsed, parseAndCountMsPerBlob: +(parseMs / parsed).toFixed(2) }, null, 1));
