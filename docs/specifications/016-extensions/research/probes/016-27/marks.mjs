// Throwaway probe (016-27), question 1: per project of a store, the test files with stored direct marks
// (`observedDirect.<project>`) and the marked paths per file (p50, max), and how many marks the
// stored static closure (`test_files.closure_paths`) does not hold. Opens the store read-only.
import { DatabaseSync } from "node:sqlite";
const db = new DatabaseSync(process.argv[2], { readOnly: true });
const runnerOf = new Map();
for (const r of db.prepare("select value from meta where key like 'runners:%'").all())
  for (const { project, runner } of JSON.parse(r.value)) runnerOf.set(project, runner);
const closure = new Map();
for (const r of db.prepare("select project, path, closure_paths from test_files").all())
  closure.set(`${r.project}\0${r.path}`, new Set(JSON.parse(r.closure_paths)));
const pct = (xs, p) => xs.length === 0 ? null : xs[Math.min(xs.length - 1, Math.floor(p * xs.length))];
const projects = new Set([...runnerOf.keys()]);
for (const r of db.prepare("select key from meta where key like 'observed%.%'").all()) projects.add(r.key.replace(/^[^.]*\./, ""));
const out = [];
for (const project of [...projects].sort()) {
  const row = db.prepare("select value from meta where key = ?").get(`observedDirect.${project}`);
  const map = row === undefined ? {} : JSON.parse(row.value);
  const counts = [], outside = [];
  for (const [file, paths] of Object.entries(map)) {
    counts.push(paths.length);
    const c = closure.get(`${project}\0${file}`) ?? new Set();
    outside.push(paths.filter((p) => !c.has(p)).length);
  }
  counts.sort((a, b) => a - b); outside.sort((a, b) => a - b);
  const testFiles = db.prepare("select count(*) n from test_files where project = ?").get(project).n;
  out.push({ project, runner: runnerOf.get(project) ?? "?", testFiles, filesWithMarks: counts.length,
    marksP50: pct(counts, 0.5), marksMax: counts.at(-1) ?? null, marksTotal: counts.reduce((a, b) => a + b, 0),
    outsideClosureP50: pct(outside, 0.5), outsideClosureMax: outside.at(-1) ?? null,
    filesWithOutsideMarks: outside.filter((n) => n > 0).length });
}
for (const o of out) console.log(JSON.stringify(o));
