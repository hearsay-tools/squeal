// Throwaway (026, tiered-pre-pr). For git ranges, counts the test files a
// range re-keys, from the stored closure lists (test_files.closure_paths:
// static imports plus declared inputs), and the test files a narrow run of the
// changed paths selects (changed test files plus namesakes of changed sources;
// direct importers are left out, so this is a lower bound of the edit cut).
// Durations: median local file time from report.json since <from>.
// Usage: node closure-delta.mjs <store copy> <runs dir> <repo> <from ISO> <range>...
//   a range is "<a>..<b>"
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join, basename } from "node:path";
import { execFileSync } from "node:child_process";

const [store, runsDir, repo, fromIso, ...ranges] = process.argv.slice(2);
const db = new DatabaseSync(store, { readOnly: true });
const tests = db.prepare("select project, path, closure_paths from test_files").all()
  .map((t) => ({ k: `${t.project}\0${t.path}`, path: t.path, closure: new Set(JSON.parse(t.closure_paths)) }));
const runs = db.prepare("select id from runs where started_at >= ?").all(Date.parse(fromIso));
const durs = new Map();
for (const r of runs) {
  let rep;
  try { rep = JSON.parse(readFileSync(join(runsDir, r.id, "report.json"), "utf8")).report; } catch { continue; }
  for (const f of rep.fileDurations ?? []) {
    const k = `${f.testFile.project}\0${f.testFile.path}`;
    (durs.get(k) ?? durs.set(k, []).get(k)).push(f.durationMs / 1000);
  }
}
const med = new Map([...durs].map(([k, v]) => { const s = v.sort((a, b) => a - b); return [k, s[Math.floor(s.length / 2)]]; }));
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", maxBuffer: 1 << 26 }).trim();
const stem = (p) => basename(p).replace(/\.(test|spec)\.[cm]?[jt]sx?$/, "").replace(/\.[cm]?[jt]sx?$/, "");
console.log("range\tchanged_paths\tlisted\tclosure_rekeyed\tclosure_file_s\tnarrow_files\tnarrow_file_s\tfull_file_s");
const out = [];
for (const range of ranges) {
  const [, b] = range.split("..");
  const listed = new Set(git("ls-tree", "-r", "--name-only", b).split("\n"));
  const live = tests.filter((t) => listed.has(t.path) && med.has(t.k));
  const changed = git("diff", "--name-only", range).split("\n").filter(Boolean);
  const re = live.filter((t) => changed.some((p) => t.closure.has(p) || t.path === p));
  const stems = new Set(changed.filter((p) => !/\.(test|spec)\./.test(p)).map(stem));
  const narrow = live.filter((t) => changed.includes(t.path) || stems.has(stem(t.path)));
  const s = (l) => l.reduce((a, t) => a + med.get(t.k), 0);
  const row = { range, n: changed.length, listed: live.length, re: re.length, reS: s(re), nar: narrow.length, narS: s(narrow), full: s(live) };
  out.push(row);
  console.log([range.replace(/([0-9a-f]{9})[0-9a-f]+/g, "$1"), row.n, row.listed, row.re, row.reS.toFixed(0), row.nar, row.narS.toFixed(0), row.full.toFixed(0)].join("\t"));
}
const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
for (const [name, f] of [["closure_rekeyed", (r) => r.re], ["closure_file_s", (r) => r.reS], ["narrow_files", (r) => r.nar], ["narrow_file_s", (r) => r.narS], ["full_file_s", (r) => r.full]])
  console.log(`${name}: p50 ${q(out.map(f), 0.5).toFixed(0)}, p75 ${q(out.map(f), 0.75).toFixed(0)}, p90 ${q(out.map(f), 0.9).toFixed(0)}, max ${Math.max(...out.map(f)).toFixed(0)}`);
