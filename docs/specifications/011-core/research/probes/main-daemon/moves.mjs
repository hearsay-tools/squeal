// 011-157 probe (throwaway), question 2: per move of the main checkout's HEAD in the window (pull, merge, checkout, commit), the test files
// it re-keys and their recorded seconds; and how many of them a clean stored row of some worktree already covered at equal content before the move.
// Usage: node moves.mjs <store copy> <repo root> <copy ms> <out.jsonl> [hours=72]
import { DatabaseSync } from "node:sqlite"; import { readFileSync, writeFileSync } from "node:fs";
import { makeSig } from "./sig.mjs";
const [, , storePath, root, copyArg, outPath, hoursArg] = process.argv;
const copyAt = Number(copyArg), since = copyAt - Number(hoursArg ?? 72) * 3600_000, gitDir = root + "/.git";
const db = new DatabaseSync(storePath, { readOnly: true });
const { sig, tree } = makeSig(db, gitDir, root + "/squeal.config.json");
// MD_LOG=<reflog path relative to .git> reads another ref, e.g. logs/refs/remotes/origin/main: a main checkout that followed origin/main at once.
const log = readFileSync(gitDir + "/" + (process.env.MD_LOG ?? "logs/HEAD"), "utf8").trim().split("\n").map((l) => { const m = l.split("\t")[0].match(/^(\w+) (\w+) .*> (\d+) [+-]\d+$/); return m && { at: Number(m[3]) * 1000, from: m[1], to: m[2], msg: (l.split("\t")[1] ?? "").split(":")[0] }; }).filter((e) => e && e.at >= since && e.at <= copyAt && e.from !== e.to);
const usual = new Map();
for (const c of db.prepare("SELECT c.project, c.test_path, group_concat(r.duration_ms) d FROM checks c JOIN results r ON r.check_id = c.id WHERE c.kind = 'file' GROUP BY c.id").all()) { const d = c.d.split(",").map(Number).sort((a, b) => a - b); usual.set(c.project + "\0" + c.test_path, d[d.length >> 1] / 1000); }
let exclude = []; try { exclude = (JSON.parse(readFileSync(root + "/squeal.config.json", "utf8")).vitest?.exclude ?? []).map((g) => new RegExp("^" + g.replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*"))); } catch {}
const allFiles = db.prepare("SELECT project, path FROM test_files WHERE path NOT LIKE '.ai/%'").all().map((t) => t.project + "\0" + t.path).filter((f) => !exclude.some((re) => re.test(f.split("\0")[1])));
// Clean stored rows per file: commit and time, for "already stored at equal content before the move".
const rows = new Map();
for (const r of db.prepare("SELECT c.project || char(0) || c.test_path f, r.commit_sha c, min(r.recorded_at) at FROM results r JOIN checks c ON c.id = r.check_id WHERE c.kind = 'file' AND r.dirty = 0 AND r.commit_sha IS NOT NULL GROUP BY f, r.commit_sha").all()) { if (!rows.has(r.f)) rows.set(r.f, []); rows.get(r.f).push(r); }
const out = []; let full = null;
for (const e of log) {
  const tT = tree(e.to), tF = tree(e.from); if (!tT || !tF) { out.push({ ...e, err: "commit not in git" }); continue; }
  const files = allFiles.filter((f) => tT.has(f.split("\0")[1]));
  let n = 0, s = 0, nStored = 0, sStored = 0; const list = [];
  for (const f of files) {
    const a = sig(f, e.to); if (tF.has(f.split("\0")[1]) && sig(f, e.from) === a) continue;
    const sec = usual.get(f) ?? 0; n++; s += sec; let stored = false;
    if ((rows.get(f) ?? []).some((r) => r.at <= e.at && sig(f, r.c) === a)) { nStored++; sStored += sec; stored = true; }
    list.push([f, Math.round(sec * 10) / 10, stored ? 1 : 0]);
  }
  const o = { iso: new Date(e.at).toISOString(), at: e.at, msg: e.msg, from: e.from.slice(0, 9), to: e.to.slice(0, 9), files: files.length, rekeyed: n, secs: Math.round(s), storedBefore: nStored, storedSecs: Math.round(sStored) };
  out.push({ ...o, list }); console.error(JSON.stringify(o));
  full = { files: files.length, secs: Math.round(files.reduce((x, f) => x + (usual.get(f) ?? 0), 0)) };
}
writeFileSync(outPath, out.map((o) => JSON.stringify(o)).join("\n") + "\n");
const ok = out.filter((o) => !o.err); const sum = (k) => ok.reduce((x, o) => x + o[k], 0);
console.log(`moves ${out.length} (${ok.length} read); re-keyed ${sum("rekeyed")} files, ${sum("secs")} s; of them stored at equal content before the move ${sum("storedBefore")} files, ${sum("storedSecs")} s; moves re-keying nothing ${ok.filter((o) => o.rekeyed === 0).length}`);
const sorted = ok.map((o) => o.secs).sort((a, b) => a - b); console.log(`per move s: median ${sorted[sorted.length >> 1]}, p90 ${sorted[Math.floor(sorted.length * 0.9)]}, max ${sorted.at(-1)}; full suite at the last move: ${JSON.stringify(full)}`);
