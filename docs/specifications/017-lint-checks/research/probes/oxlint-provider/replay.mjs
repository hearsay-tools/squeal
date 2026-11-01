// Q2 replay (throwaway). Copies the fixture to a scratch folder, writes a root
// config for one mode, then applies N seeded edits. After each edit:
//   1. truth: a fresh `oxlint --format json` over the whole fixture, plus
//      `--debug files` for which files oxlint lints (an ignored file has no line);
//   2. each key variant is computed from declared inputs on disk, and the
//      truth is stored under it. A key seen before with another result is a miss,
//      named by the edit's category;
//   3. a part run: a fresh `oxlint` on the files whose K4 key is new, compared
//      with the truth for those files.
// Usage: node replay.mjs <mode A|B|C|D> <steps> <seed> <scratch> <toolDir>
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [mode, stepsArg, seedArg, scratch, toolDir] = process.argv.slice(2);
const STEPS = Number(stepsArg);
const here = path.dirname(new URL(import.meta.url).pathname);
const typeAware = mode === "B" || mode === "D";
const jsPlugins = mode === "C" || mode === "D";
const W = path.join(scratch, `replay-${mode}`);

// ---- setup -------------------------------------------------------------
fs.rmSync(W, { recursive: true, force: true });
fs.cpSync(path.join(here, "fixture"), W, { recursive: true });
fs.mkdirSync(path.join(W, "node_modules/.bin"), { recursive: true });
for (const n of ["oxlint", "@oxlint", "oxlint-tsgolint", "@oxlint-tsgolint", "typescript"])
  fs.symlinkSync(path.join(toolDir, "node_modules", n), path.join(W, "node_modules", n));
fs.symlinkSync("../oxlint-tsgolint/bin/tsgolint.js", path.join(W, "node_modules/.bin/tsgolint"));
fs.renameSync(path.join(W, "probe-dep"), path.join(W, "node_modules/probe-dep"));
const rootConfig = () => ({
  extends: ["./configs/base.json"],
  plugins: ["eslint", "typescript", "import"],
  ...(jsPlugins ? { jsPlugins: ["./plugins/local.mjs"] } : {}),
  ...(typeAware ? { options: { typeAware: true } } : {}),
  ignorePatterns: ["gen/**", ...(S.ignoreC ? ["src/c.ts"] : [])],
  rules: {
    "no-unused-vars": S.unusedWarn ? "warn" : "error",
    "import/named": "error",
    "import/no-cycle": "error",
    ...(typeAware ? { "typescript/no-floating-promises": "error" } : {}),
    ...(jsPlugins ? { "local/no-ident": "error", "local/no-word": "error" } : {}),
  },
});
execFileSync("git", ["init", "-q", W]);

// ---- edits ---------------------------------------------------------------
const S = {};
const w = (rel, text) => fs.writeFileSync(path.join(W, rel), text);
const rm = (rel) => fs.rmSync(path.join(W, rel), { force: true });
const toggle = (k) => (S[k] = !S[k]);
const json = (o) => JSON.stringify(o, null, 2) + "\n";
const EDITS = [
  ["file", 3, "a.ts unused var", () => w("src/a.ts", `import { greet } from "./b.js";\n\nexport function main(): string {\n${toggle("aUnused") ? "" : "  const unused = 1;\n"}  return greet("x");\n}\n`)],
  ["file", 2, "w.ts identifier", () => w("src/w.ts", `export const word = "allowed";\nexport const ${toggle("wBar") ? "bar2" : "foo"} = 1;\n`)],
  ["import-target", 2, "n.js export renamed (m.js imports it)", () => w("src/n.js", `export const ${toggle("nRen") ? "nval2" : "nval"} = 1;\n`)],
  ["import-graph", 2, "d.ts imports c.ts", () => w("src/d.ts", toggle("cycle") ? `import { c } from "./c.js";\n\nexport const d = (): number => 1;\nexport const dc = c;\n` : `export const d = (): number => 1;\n`)],
  ["installed-package", 1, "probe-dep export renamed", () => { const v = toggle("depRen") ? "val2" : "val"; w("node_modules/probe-dep/index.js", `export const ${v} = 1;\n`); w("node_modules/probe-dep/index.d.ts", `export declare const ${v}: number;\n`); }],
  ["type-program", 2, "u.ts returns a Promise", () => w("src/u.ts", toggle("uPromise") ? `export async function load(): Promise<number> {\n  return 1;\n}\n` : `export function load(): number {\n  return 1;\n}\n`)],
  ["tsconfig", 1, "tsconfig strict and exclude t.ts", () => { const t = JSON.parse(fs.readFileSync(path.join(W, "tsconfig.json"), "utf8")); if (toggle("tsEx")) t.exclude = ["src/t.ts"]; else delete t.exclude; w("tsconfig.json", json(t)); }],
  ["extends", 1, "base.json eqeqeq", () => w("configs/base.json", json({ rules: { eqeqeq: toggle("eqOff") ? "off" : "error" } }))],
  ["root-config", 1, "root no-unused-vars severity", () => { toggle("unusedWarn"); w(".oxlintrc.json", json(rootConfig())); }],
  ["nested-config", 1, "pkg config overrides eqeqeq", () => w("pkg/.oxlintrc.json", json({ extends: ["../configs/base.json"], plugins: ["typescript"], rules: { "no-debugger": "error", ...(toggle("pkgEqOff") ? { eqeqeq: "off" } : {}) } }))],
  ["nested-new", 1, "pkg/sub config appears", () => (toggle("subCfg") ? w("pkg/sub/.oxlintrc.json", json({ rules: { eqeqeq: "off" } })) : rm("pkg/sub/.oxlintrc.json"))],
  ["ignore-file", 1, ".eslintignore lists w.ts", () => w(".eslintignore", toggle("ignW") ? "src/w.ts\n" : "")],
  ["ignore-pattern", 1, "ignorePatterns lists c.ts", () => { toggle("ignoreC"); w(".oxlintrc.json", json(rootConfig())); }],
  ["suppressions", 1, "oxlint-suppressions.json for a.ts", () => (toggle("supp") ? w("oxlint-suppressions.json", json({ "src/a.ts": { "no-unused-vars": { count: 1 } } })) : rm("oxlint-suppressions.json"))],
  ...(jsPlugins
    ? [
        ["js-import", 1, "plugin helper bans another name", () => w("plugins/helper.mjs", `export const BANNED_IDENT = "${toggle("helperBar") ? "bar2" : "foo"}";\n`)],
        ["js-read", 1, "banned.txt read by a rule", () => w("banned.txt", toggle("bannedAllowed") ? "allowed\n" : "forbidden\n")],
        ["js-plugin", 1, "plugin message text", () => { const f = path.join(W, "plugins/local.mjs"); const t = fs.readFileSync(f, "utf8"); w("plugins/local.mjs", toggle("msg") ? t.replace("is banned.`", "is not allowed.`") : t.replace("is not allowed.`", "is banned.`")); }],
      ]
    : []),
];
w(".oxlintrc.json", json(rootConfig()));

let seed = Number(seedArg);
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed / 2147483648);
const bag = EDITS.flatMap((e) => Array(e[1]).fill(e));
// Each category at least STEPS/40 times: a fixed sweep first, then seeded picks.
const schedule = [];
for (let r = 0; r < 3; r++) for (const e of EDITS) schedule.push(e);
while (schedule.length < STEPS) schedule.push(bag[Math.floor(rand() * bag.length)]);
for (let i = schedule.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [schedule[i], schedule[j]] = [schedule[j], schedule[i]]; }

// ---- running oxlint ------------------------------------------------------
const OX = path.join(W, "node_modules/oxlint/bin/oxlint");
const env = { ...process.env, HOME: path.join(scratch, "home"), NO_COLOR: "1" };
function run(args, observe) {
  const obs = path.join(scratch, `obs-${mode}.json`);
  const timeOut = path.join(scratch, `time-${mode}.txt`);
  const nodeArgs = observe ? ["--import", path.join(here, "observe.mjs")] : [];
  const r = spawnSync("/usr/bin/time", ["-f", "%U %S %M %e", "-o", timeOut, "nice", "-n", "10", process.execPath, ...nodeArgs, OX, ...args], { cwd: W, env: { ...env, OBSERVE_OUT: obs }, encoding: "utf8", maxBuffer: 64 << 20 });
  const [u, s, rss, wall] = fs.readFileSync(timeOut, "utf8").trim().split("\n").pop().split(" ").map(Number);
  const observed = observe && fs.existsSync(obs) ? JSON.parse(fs.readFileSync(obs, "utf8")) : [];
  if (observe) fs.rmSync(obs, { force: true });
  return { out: r.stdout, err: r.stderr, status: r.status, cpu: (u + s) * 1000, rss, wall, observed };
}
function lintSet(paths) {
  const r = run(["--debug", "files", ...paths], false);
  return new Set(r.out.split("\n").map((l) => l.trim()).filter((l) => l && !l.includes(" ")));
}
function findings(paths) {
  const r = run(["--format", "json", ...paths], true);
  let j;
  try { j = JSON.parse(r.out); } catch { return { error: (r.out + r.err).split("\n")[0], run: r }; }
  const by = new Map();
  for (const d of j.diagnostics) {
    const l = d.labels?.[0]?.span;
    const f = d.filename ?? "(none)";
    if (!by.has(f)) by.set(f, []);
    by.get(f).push(`${d.code}|${d.severity}|${d.message}|${l?.line ?? 0}:${l?.column ?? 0}`);
  }
  for (const v of by.values()) v.sort();
  return { by, run: r };
}

// ---- keys ----------------------------------------------------------------
const blob = (rel) => { try { return createHash("sha1").update(fs.readFileSync(path.join(W, rel))).digest("hex").slice(0, 12); } catch { return "-"; } };
const h = (o) => createHash("sha1").update(JSON.stringify(o)).digest("hex").slice(0, 16);
const CONFIG_NAMES = [".oxlintrc.json", ".oxlintrc.jsonc", "oxlint.config.ts", "oxlint.config.mts"];
function extendsClosure(rel, acc = []) {
  if (acc.some(([p]) => p === rel)) return acc;
  acc.push([rel, blob(rel)]);
  if (!rel.endsWith(".json") && !rel.endsWith(".jsonc")) return acc;
  try {
    const c = JSON.parse(fs.readFileSync(path.join(W, rel), "utf8"));
    for (const e of c.extends ?? []) extendsClosure(path.join(path.dirname(rel), e), acc);
  } catch {}
  return acc;
}
function configChain(file) {
  // The root config, and each folder between the file and the root: its config or none.
  const parts = [];
  for (let d = path.dirname(file); d !== "."; d = path.dirname(d)) {
    const found = CONFIG_NAMES.find((n) => fs.existsSync(path.join(W, d, n)));
    parts.push([d, found ? extendsClosure(path.join(d, found)) : null]);
  }
  const root = CONFIG_NAMES.find((n) => fs.existsSync(path.join(W, n)));
  return { root: root ? extendsClosure(root) : null, folders: parts };
}
const MODULE_EXT = /\.(m|c)?(j|t)sx?$|\.json$/;
function listing() {
  return execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: W, encoding: "utf8" }).split("\n").filter(Boolean).sort();
}
const VERSIONS = { oxlint: JSON.parse(fs.readFileSync(path.join(toolDir, "node_modules/oxlint/package.json"), "utf8")).version, tsgolint: typeAware ? JSON.parse(fs.readFileSync(path.join(toolDir, "node_modules/oxlint-tsgolint/package.json"), "utf8")).version : null, node: jsPlugins ? process.versions.node.split(".")[0] : null };
function keys(file, list, observed) {
  const k1 = { file: blob(file), path: file, VERSIONS, chain: configChain(file), eslintignore: blob(".eslintignore"), gitignore: blob(".gitignore"), suppressions: blob("oxlint-suppressions.json") };
  const program = list.filter((p) => MODULE_EXT.test(p)).map((p) => [p, blob(p)]);
  const install = fs.readdirSync(path.join(W, "node_modules/probe-dep")).sort().map((n) => [n, blob(`node_modules/probe-dep/${n}`)]);
  const k2 = { k1, program, install };
  const declared = jsPlugins ? [["plugins/local.mjs", blob("plugins/local.mjs")]] : [];
  const k3 = { k2, declared };
  const obs = observed.map((a) => path.relative(W, a)).filter((r) => !r.startsWith("..") && !r.startsWith("node_modules/")).sort().map((r) => [r, blob(r)]);
  const k4 = { k3, obs };
  return { K1: h(k1), K2: h(k2), K3: h(k3), K4: h(k4) };
}

// ---- replay --------------------------------------------------------------
const VARIANTS = ["K1", "K2", "K3", "K4"];
const stores = Object.fromEntries(VARIANTS.map((v) => [v, new Map()]));
const misses = Object.fromEntries(VARIANTS.map((v) => [v, {}]));
const partDiff = [];
const costs = [];
const log = [];
let observedLast = [];
let prevTruth = new Map();
const oneDiff = [];
let oneRuns = 0;
for (let step = 0; step <= STEPS; step++) {
  const edit = step === 0 ? ["start", 0, "initial", () => {}] : schedule[step - 1];
  edit[3]();
  const list = listing();
  const linted = lintSet([]);
  const t = findings([]);
  if (t.error) { log.push({ step, edit: edit[2], error: t.error }); continue; }
  costs.push({ kind: "whole", files: linted.size, cpu: t.run.cpu, wall: t.run.wall, rss: t.run.rss, load: os.loadavg()[0] });
  const truth = new Map(list.filter((p) => MODULE_EXT.test(p) && !p.endsWith(".json")).map((p) => [p, linted.has(p) ? JSON.stringify(t.by.get(p) ?? []) : "ignored"]));
  observedLast = t.run.observed;
  const newK4 = [];
  for (const [file, res] of truth) {
    const k = keys(file, list, observedLast);
    for (const v of VARIANTS) {
      const prev = stores[v].get(k[v]);
      if (prev !== undefined && prev !== res) {
        misses[v][edit[0]] = (misses[v][edit[0]] ?? 0) + 1;
        log.push({ step, edit: edit[2], cat: edit[0], variant: v, file, was: prev, now: res });
      }
      if (v === "K4" && prev === undefined) newK4.push(file);
      stores[v].set(k[v], res);
    }
  }
  // The part run: what Squeal would lint at this step.
  if (newK4.length && step > 0) {
    const part = newK4.slice(0, 16);
    const pl = lintSet(part);
    const pr = findings(part);
    costs.push({ kind: "part", files: part.length, cpu: pr.run.cpu, wall: pr.run.wall, rss: pr.run.rss, load: os.loadavg()[0] });
    for (const f of part) {
      const got = pl.has(f) ? JSON.stringify(pr.by?.get(f) ?? []) : "ignored";
      if (got !== truth.get(f)) partDiff.push({ step, edit: edit[2], file: f, part, whole: truth.get(f), got });
    }
  }
  // One-file runs: each file whose truth changed (at most 3), linted alone.
  const changed = [...truth].filter(([f, r]) => prevTruth.has(f) && prevTruth.get(f) !== r && r !== "ignored").map(([f]) => f).slice(0, 3);
  for (const f of changed) {
    const pr = findings([f]);
    oneRuns++;
    costs.push({ kind: "one", files: 1, cpu: pr.run.cpu, wall: pr.run.wall, rss: pr.run.rss, load: os.loadavg()[0] });
    const got = JSON.stringify(pr.by?.get(f) ?? []);
    if (got !== truth.get(f)) oneDiff.push({ step, edit: edit[2], file: f, whole: truth.get(f), got });
  }
  prevTruth = truth;
}
const summary = { mode, typeAware, jsPlugins, steps: STEPS, versions: VERSIONS, editsPerCategory: Object.fromEntries(EDITS.map((e) => [e[0] + ": " + e[2], schedule.slice(0, STEPS).filter((s) => s === e).length])), misses, partDiffCount: partDiff.length, partDiff: partDiff.slice(0, 20), oneRuns, oneDiffCount: oneDiff.length, oneDiff: oneDiff.slice(0, 20), errors: log.filter((l) => l.error) };
fs.writeFileSync(path.join(here, "out", `replay-${mode}.json`), JSON.stringify({ summary, log, costs }, null, 1));
console.log(JSON.stringify(summary, null, 1));
