// Throwaway probe (row 018-56). For each file `ci export` left out for inputs, gives each
// uncertified (file, input) pair a kind, then counts the files and test seconds each
// candidate rule would recover. Usage:
//   node rules.mjs <uncertified.json> <checkout> <part-dir>... > files.tsv   (summary on stderr)
// <uncertified.json>: what the patched `ci export` wrote (README.md). Part dirs are read for
// *.json parts, not recursively. Reads only; writes stdout and stderr.
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, matchesGlob } from "node:path";

const [uncertifiedFile, checkout, ...dirs] = process.argv.slice(2);
const uncertified = JSON.parse(readFileSync(uncertifiedFile, "utf8"));
const config = JSON.parse(readFileSync(join(checkout, "squeal.config.json"), "utf8"));

const parts = [];
for (const dir of dirs)
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
    const part = JSON.parse(readFileSync(join(dir, name), "utf8"));
    parts.push({ label: `${dir.split("/").slice(-1)[0]}/${name.slice(12, 20)}`, part });
  }
const id = (f) => `${f.project}\0${f.path}`;
const owner = new Map();
// A node:test part names no project (the export assigns its entry), so it is also found by path.
for (const p of parts) for (const f of p.part.testFiles) owner.set(id(f), { p, f }).set(`*\0${f.path}`, { p, f });

const tree = new Map();
const ls = execFileSync("git", ["ls-tree", "-r", "-z", "HEAD"], { cwd: checkout, maxBuffer: 1 << 30 }).toString();
for (const entry of ls.split("\0")) {
  if (!entry) continue;
  const [meta, path] = entry.split("\t");
  tree.set(path, meta.split(" ")[2]);
}
const ABSENT_LISTING = createHash("sha1").update("\0absent").digest("hex");
const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
// The content here as a key holds it (src/core/ci/inputs.ts `hereOf`), and the path's kind.
function here(path) {
  if (path.endsWith("/")) {
    const dir = path === "./" ? checkout : join(checkout, path.slice(0, -1));
    try {
      const names = readdirSync(dir).sort(cmp);
      return { kind: "listing", hash: createHash("sha1").update(names.join("\0")).digest("hex") };
    } catch {
      return { kind: "listing", hash: ABSENT_LISTING };
    }
  }
  if (tree.has(path)) return { kind: "tracked", hash: tree.get(path) };
  const abs = join(checkout, path);
  if (existsSync(abs)) {
    if (statSync(abs).isDirectory()) return { kind: "directory", hash: undefined };
    const hash = execFileSync("git", ["hash-object", path], { cwd: checkout }).toString().trim();
    return { kind: "untracked", hash };
  }
  return { kind: "missing", hash: null };
}

// node:path matchesGlob skips dot segments under **; Squeal's globs match them, so hide the dots.
const undot = (p) => p.replace(/(^|\/)\./g, "$1_");
const declared = (file, input) =>
  Object.entries(config.inputs ?? {}).some(
    ([tests, globs]) => matchesGlob(file, tests) && globs.some((g) => matchesGlob(undot(input), undot(g))),
  );

/*
 * Kinds, from the file's own part (its command's evidence) and every other part:
 *   own-differs   the own command read other content: no rule here recovers it
 *   own-touched   the own command's evidence lacks it, but the file's own observed set holds it:
 *                 a hooked process read it and a write, two contents or a withheld child cancelled it
 *   C             no evidence in the own command; another part read it with the content here
 *   C-other       no evidence in the own command; another part read other content
 *   D-<here kind> no part read it; tracked, missing, untracked, listing
 */
function kind(own, p, f, input, h) {
  if (Object.hasOwn(own.evidence, input)) return own.evidence[input] === h.hash ? "certified?" : "own-differs";
  const obs = f.observed ?? {};
  const touched = [obs.paths, obs.directories, obs.direct, f.loaded].some((l) => (l ?? []).includes(input));
  if (touched) return "own-touched";
  const others = parts.filter((q) => q.part !== own && Object.hasOwn(q.part.evidence, input));
  if (others.some((q) => q.part.evidence[input] === h.hash)) return `C/${h.kind}`;
  if (others.length > 0) return "C-other";
  return `D-${h.kind}`;
}

const RULES = {
  // Candidate rule C: the own command never read it, another part read it at the content here.
  C: (k) => k === "C",
  // Candidate rule D: no part read it; the file exists here at the commit's content (start = end = blob).
  D: (k) => k === "D-tracked",
  // D, also for a path absent here (start = end = absent).
  "D+absent": (k) => k === "D-tracked" || k === "D-missing",
  "C or D": (k) => k === "C" || k === "D-tracked",
  // One rule for both: every input the own command never touched, certified by its own start and end.
  "C or D+absent": (k) => k === "C" || k === "D-tracked" || k === "D-missing",
  // The recommended one rule: own start = end = here, for a file or a listing, never an absence.
  "one rule, no absence": (k, full) =>
    ["C/tracked", "C/listing", "C/untracked", "D-tracked", "D-listing", "D-untracked"].includes(full),
  "one rule, files only": (k, full) => ["C/tracked", "C/untracked", "D-tracked", "D-untracked"].includes(full),
};

const hereCache = new Map();
const files = [];
const pairKinds = new Map();
const topInputs = new Map();
for (const { testFile, inputs } of uncertified) {
  const o = owner.get(id(testFile)) ?? owner.get(`*\0${testFile.path}`);
  if (o === undefined) throw new Error(`no part holds ${testFile.project}:${testFile.path}`);
  const { p, f } = o;
  const runner = p.part.header.runner;
  const kinds = new Map();
  for (const input of inputs) {
    if (!hereCache.has(input)) hereCache.set(input, here(input));
    let k = kind(p.part, p, f, input, hereCache.get(input));
    if (k.startsWith("D-") && declared(testFile.path, input)) k += " (declared)";
    else if (k.startsWith("D-")) k += " (graph)";
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
    pairKinds.set(`${runner}\t${k}`, (pairKinds.get(`${runner}\t${k}`) ?? 0) + 1);
    const t = `${k}\t${input}`;
    topInputs.set(t, (topInputs.get(t) ?? 0) + 1);
  }
  files.push({ runner, project: testFile.project, path: testFile.path, seconds: f.durationMs / 1000, kinds });
}

const base = (k) => k.replace(/ \(.*\)$/, "").replace(/\/.*$/, "");
const full = (k) => k.replace(/ \(.*\)$/, "");
process.stdout.write("runner\tproject\ttest file\tseconds\tkinds (pairs)\n");
for (const f of files.sort((a, b) => cmp(id(a), id(b))))
  process.stdout.write(
    `${f.runner}\t${f.project}\t${f.path}\t${f.seconds.toFixed(1)}\t${[...f.kinds].map(([k, n]) => `${k} (${n})`).join(", ")}\n`,
  );

const say = (s) => process.stderr.write(`${s}\n`);
const runners = [...new Set(files.map((f) => f.runner))].sort();
say(`left out: ${files.length} files, ${files.reduce((s, f) => s + f.seconds, 0).toFixed(1)} s`);
for (const r of runners) {
  const of = files.filter((f) => f.runner === r);
  say(`  ${r}: ${of.length} files, ${of.reduce((s, f) => s + f.seconds, 0).toFixed(1)} s`);
}
say("\npairs per runner and kind");
for (const [k, n] of [...pairKinds].sort()) say(`  ${n}\t${k}`);
say("\nfiles (test s) each rule recovers: every uncertified input of the file is of the rule's kinds");
for (const [name, ok] of Object.entries(RULES)) {
  const cells = runners.map((r) => {
    const rec = files.filter((f) => f.runner === r && [...f.kinds.keys()].every((k) => ok(base(k), full(k))));
    return `${r} ${rec.length} (${rec.reduce((s, f) => s + f.seconds, 0).toFixed(1)} s)`;
  });
  say(`  ${name.padEnd(14)} ${cells.join("  ")}`);
}
say("\nfiles per exact kind set");
const sets = new Map();
for (const f of files) {
  const key = `${f.runner}\t${[...new Set([...f.kinds.keys()].map(full))].sort().join(" + ")}`;
  const v = sets.get(key) ?? { n: 0, s: 0 };
  sets.set(key, { n: v.n + 1, s: v.s + f.seconds });
}
for (const [k, v] of [...sets].sort((a, b) => b[1].n - a[1].n)) say(`  ${v.n}\t${v.s.toFixed(1)} s\t${k}`);
say("\ninputs in most left-out files, per kind (top 25)");
for (const [k, n] of [...topInputs].sort((a, b) => b[1] - a[1]).slice(0, 25)) say(`  ${n}\t${k}`);
