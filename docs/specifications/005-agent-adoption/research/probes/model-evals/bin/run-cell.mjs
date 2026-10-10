#!/usr/bin/env node
// Throwaway probe for 005-06 (model-evals). Not product code.
//
// Runs one cell (task x variant x harness x model x repetition) end to end, isolated:
//   node run-cell.mjs <task> <variant> <claude|codex> <model> [rep] [--cold] [--dry] [--max-load 24] [--timeout-s 900] [--effort medium]
// --dry builds the cell and warms it, then stops the daemon without a session.
// --effort pins the reasoning effort (005-07): `claude -p --effort <level>`, `codex exec -c model_reasoning_effort="<level>"`.
// The 005-06 pilot ran before this option, at each model's unrecorded default.
//
// Everything lives under $SQ_EVALS_ROOT (default /tmp/sq-evals-2a41):
//   pin-base/            `git archive` of this repository's plugins at the pinned commit (prepare.sh)
//   nm/node_modules      one Vitest 5.0.3 install, copied into each work tree
//   pins/<variant>/      the pin with the variant's patches applied, built once
//   cells/<id>/home      HOME for the subject harness (no real ~/.claude or ~/.codex is read or written)
//   cells/<id>/codex     CODEX_HOME: the host provider block (URL read at run time, never committed), the pinned plugin
//   cells/<id>/tmp       TMPDIR
//   cells/<id>/work      the fixture, committed at a fixed date, its store warmed unless --cold
//   cells/<id>/out       events.jsonl (timestamped), load.tsv, truth, diff, store copy, grade.json
// Every daemon the cell started is stopped; any process still naming the cell's directory is listed and killed.

import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { loadavg } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..");
const ROOT = process.env.SQ_EVALS_ROOT ?? "/tmp/sq-evals-2a41";

const argv = process.argv.slice(2);
const flag = (name, dflt) => {
  const i = argv.indexOf(name);
  if (i < 0) return dflt;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
};
const dry = argv.includes("--dry") ? (argv.splice(argv.indexOf("--dry"), 1), true) : false;
const cold = argv.includes("--cold") ? (argv.splice(argv.indexOf("--cold"), 1), true) : false;
const maxLoad = Number(flag("--max-load", "24"));
const timeoutS = Number(flag("--timeout-s", "900"));
const effort = flag("--effort", "medium");
if (!/^(low|medium|high|xhigh|max)$/.test(effort)) throw new Error(`--effort ${effort}: not a level both harnesses take`);
const [task, variantName, harness, model, rep = "1"] = argv;
if (!task || !variantName || !["claude", "codex"].includes(harness) || !model) {
  console.error("usage: run-cell.mjs <task> <variant> <claude|codex> <model> [rep] [--cold] [--max-load 24] [--timeout-s 900]");
  process.exit(2);
}
if (/fable/i.test(model)) throw new Error("never Fable (brief)");

const variant = JSON.parse(readFileSync(join(PROBE, "variants", `${variantName}.json`), "utf8"));
const id = `${task}.${variantName}.${harness}-${model.replace(/[^\w.-]/g, "_")}.e-${effort}.r${rep}${cold ? ".cold" : ""}`;
const CELL = join(ROOT, "cells", id);
const OUT = join(CELL, "out");
if (existsSync(join(OUT, "grade.json"))) {
  console.log(`skip ${id}: already graded`);
  process.exit(0);
}

const load1 = () => loadavg()[0];
if (load1() >= maxLoad) {
  console.log(`held ${id}: load ${load1().toFixed(1)} >= ${maxLoad}`);
  process.exit(75);
}

rmSync(CELL, { recursive: true, force: true });
for (const d of ["home", "tmp", "work", "out", "codex"]) mkdirSync(join(CELL, d), { recursive: true });
const WORK = join(CELL, "work");
const log = (s) => {
  appendFileSync(join(OUT, "runner.log"), `${new Date().toISOString()} ${s}\n`);
  console.log(`[${id}] ${s}`);
};

// ---------- environment: the parent's CLAUDE*, CEZ_* and Codex thread variables removed ----------
const env = {};
for (const [k, v] of Object.entries(process.env)) {
  if (/^(CLAUDE|CEZ_|CODEX_(SESSION|THREAD))/.test(k)) continue;
  env[k] = v;
}
Object.assign(env, {
  HOME: join(CELL, "home"),
  TMPDIR: join(CELL, "tmp"),
  CODEX_HOME: join(CELL, "codex"),
  DISABLE_AUTOUPDATER: "1",
  GIT_AUTHOR_NAME: "ledgerline",
  GIT_AUTHOR_EMAIL: "dev@ledgerline.invalid",
  GIT_COMMITTER_NAME: "ledgerline",
  GIT_COMMITTER_EMAIL: "dev@ledgerline.invalid",
});
const fixedDate = { GIT_AUTHOR_DATE: "2026-10-01T09:00:00Z", GIT_COMMITTER_DATE: "2026-10-01T09:00:00Z" };

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: WORK, env: { ...env, ...(opts.env ?? {}) }, encoding: "utf8", timeout: opts.timeout ?? 600_000 });
  if (opts.check !== false && r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} exited ${r.status}: ${r.stderr}${r.stdout}`);
  return r;
}

// ---------- the variant's pinned plugin copy ----------
function pinFor(name, v) {
  const dir = join(ROOT, "pins", name);
  if (existsSync(join(dir, "PIN.json"))) return dir;
  rmSync(dir, { recursive: true, force: true });
  cpSync(join(ROOT, "pin-base"), dir, { recursive: true });
  // Codex: the marketplace takes the hub's name, so the plugin id is squeal@hearsay (005-02).
  const mk = join(dir, ".agents/plugins/marketplace.json");
  writeFileSync(mk, readFileSync(mk, "utf8").replace('"name": "squeal"', '"name": "hearsay"'));
  const applied = [];
  for (const p of v.patch ?? []) {
    let count = 0;
    const [pluginsGlob] = p.files.split("/dist/");
    for (const plugin of readdirSync(join(dir, "plugins"))) {
      if (!pluginsGlob.endsWith("*") && !pluginsGlob.endsWith(plugin)) continue;
      const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
      for (const f of walk(join(dir, "plugins", plugin, "dist")).filter((f) => f.endsWith(".mjs"))) {
        const text = readFileSync(f, "utf8");
        const n = text.split(p.find).length - 1;
        if (n) writeFileSync(f, text.replaceAll(p.find, p.replace));
        count += n;
      }
    }
    if (count < (p.min ?? 1)) throw new Error(`variant ${name}: patch matched ${count} times, expected at least ${p.min}`);
    applied.push({ find: p.find.slice(0, 60), count });
  }
  for (const r of v.remove ?? []) rmSync(join(dir, r), { recursive: true, force: true });
  writeFileSync(join(dir, "PIN.json"), JSON.stringify({ variant: name, applied, removed: v.remove ?? [] }, null, 2));
  return dir;
}

const t0Setup = Date.now();
const PIN = pinFor(variantName, variant);
const CLI = join(PIN, "plugins", harness === "codex" ? "codex" : "claude-code", "dist/cli/squeal.mjs");
const squeal = (...args) => sh("node", ["--disable-warning=ExperimentalWarning", CLI, ...args], { check: false });

// ---------- the fixture, committed at a fixed date ----------
cpSync(join(PROBE, "fixture"), WORK, { recursive: true });
const base = readFileSync(join(WORK, "BASE.md"), "utf8");
rmSync(join(WORK, "BASE.md"));
const instructions = variant.instructions ? `${base}\n${variant.instructions}` : base;
writeFileSync(join(WORK, "CLAUDE.md"), instructions);
writeFileSync(join(WORK, "AGENTS.md"), instructions);
if (variant.policy) {
  const p = JSON.parse(readFileSync(join(WORK, "squeal.config.json"), "utf8"));
  writeFileSync(join(WORK, "squeal.config.json"), `${JSON.stringify({ ...p, ...variant.policy }, null, 2)}\n`);
}
cpSync(join(ROOT, "nm/node_modules"), join(WORK, "node_modules"), { recursive: true, verbatimSymlinks: true });
sh("git", ["init", "-q", "-b", "main"]);
sh("git", ["add", "-A"]);
sh("git", ["commit", "-qm", "ledgerline 1.4.0"], { env: fixedDate });
const head = sh("git", ["rev-parse", "HEAD"]).stdout.trim();
log(`fixture ${head}, pin ${relative(ROOT, PIN)}, load ${load1().toFixed(1)}`);

// A policy key the pinned CLI does not know is a variant that cannot run here (D8 before it ships).
if (variant.policy) {
  const st = squeal("status");
  if (/unknown key|not a key|problem/i.test(st.stdout + st.stderr) && /testCommand|denyWhenCurrent/.test(st.stdout + st.stderr)) {
    writeFileSync(join(OUT, "grade.json"), JSON.stringify({ id, skipped: "policy key unknown to the pinned CLI" }));
    log("skipped: policy key unknown to the pinned CLI");
    process.exit(0);
  }
}

// ---------- Codex: scratch CODEX_HOME, provider block, the pinned plugin installed and trusted ----------
if (harness === "codex") {
  const real = readFileSync(join(process.env.HOME, ".codex/config.toml"), "utf8");
  const baseUrl = /\[model_providers\.cliproxy\][^[]*?base_url\s*=\s*"([^"]+)"/s.exec(real)?.[1];
  if (!baseUrl) throw new Error("no cliproxy provider in ~/.codex/config.toml");
  writeFileSync(
    join(CELL, "codex/config.toml"),
    [
      'model_provider = "cliproxy"',
      `model = "${model}"`,
      'approval_policy = "never"',
      'sandbox_mode = "danger-full-access"',
      "check_for_update_on_startup = false",
      "",
      "[model_providers.cliproxy]",
      'name = "CLI Proxy"',
      `base_url = "${baseUrl}"`,
      'env_key = "CLIPROXY_API_KEY"',
      'wire_api = "responses"',
      "requires_openai_auth = false",
      "supports_websockets = true",
      "",
    ].join("\n"),
  );
  if (variant.plugin !== false) {
    sh("codex", ["plugin", "marketplace", "add", PIN]);
    sh("codex", ["plugin", "add", "squeal@hearsay"]);
    const trust = squeal("init", "--harness", "codex", "--trust", "--yes");
    log(`codex trust: ${(trust.stdout + trust.stderr).split("\n").filter(Boolean).slice(-1)[0] ?? ""}`);
    sh("git", ["checkout", "-q", "--", "."], { check: false });
  }
}

// ---------- the daemon, warm unless --cold ----------
if (variant.plugin !== false && !cold) {
  squeal("start");
  const w = squeal("run", "--all", "--wait");
  writeFileSync(join(OUT, "warmup.txt"), w.stdout + w.stderr);
  log(`warm-up: ${(w.stdout.match(/^Known failures: .*$/m) ?? ["?"])[0]}`);
}
const setupS = (Date.now() - t0Setup) / 1000;
if (dry) {
  writeFileSync(join(OUT, "git-status.txt"), sh("git", ["status", "--short", "--ignored"], { check: false }).stdout);
  if (variant.plugin !== false) log(`dry: ${(squeal("stop", WORK).stdout).trim()}`);
  log(`dry run: setup ${setupS.toFixed(1)} s`);
  process.exit(0);
}

// ---------- the session ----------
const prompt = readFileSync(join(PROBE, "tasks", `${task}.txt`), "utf8").trim() + "\n" + readFileSync(join(PROBE, "tasks", "_ending.txt"), "utf8");
writeFileSync(join(OUT, "prompt.txt"), prompt);
let cmd, args;
if (harness === "claude") {
  cmd = "claude";
  args = ["-p", prompt, "--model", model, "--effort", effort, "--output-format", "stream-json", "--verbose", "--include-hook-events",
    "--setting-sources", "project", "--strict-mcp-config", "--permission-mode", "acceptEdits",
    ...(variant.plugin === false ? [] : ["--plugin-dir", join(PIN, "plugins/claude-code")]),
    "--allowedTools", "Bash(git:*)", "Bash(grep:*)", "Bash(ls:*)", "Bash(cat:*)", "Bash(npx vitest:*)", "Bash(npm test:*)",
    "Bash(npm run:*)", "Bash(node --test:*)", "Bash(squeal:*)", "Bash(sleep:*)", "Read", "Edit", "Write", "Glob", "Grep"];
} else {
  cmd = "codex";
  args = ["exec", "--json", "-s", "danger-full-access", "-m", model, "-c", `model_reasoning_effort="${effort}"`, prompt];
}

const samples = [];
const sample = () => {
  const l = loadavg();
  samples.push(l[0]);
  appendFileSync(join(OUT, "load.tsv"), `${Date.now()}\t${l.map((x) => x.toFixed(2)).join("\t")}\n`);
};
const T0 = Date.now();
writeFileSync(join(OUT, "t0"), String(T0));
sample();
const timer = setInterval(sample, 5000);
log(`session ${cmd} ${model} effort ${effort} start, load ${load1().toFixed(1)}`);
const child = spawn(cmd, args, { cwd: WORK, env, stdio: ["ignore", "pipe", "pipe"] });
let buf = "";
child.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let v;
    try { v = JSON.parse(line); } catch { v = { raw: line }; }
    appendFileSync(join(OUT, "events.jsonl"), `${JSON.stringify({ t: Date.now() - T0, ...v })}\n`);
  }
});
child.stderr.on("data", (d) => appendFileSync(join(OUT, "stderr.txt"), d));
const killer = setTimeout(() => { log("timeout: killing the session"); child.kill("SIGTERM"); }, timeoutS * 1000);
const exit = await new Promise((resolve) => child.on("close", (code, signal) => resolve({ code, signal })));
clearTimeout(killer);
clearInterval(timer);
sample();
const T1 = Date.now();
writeFileSync(join(OUT, "t1"), String(T1));
log(`session end ${JSON.stringify(exit)} after ${((T1 - T0) / 1000).toFixed(1)} s`);

// ---------- after: Squeal's view, ground truth, diff, store copy, daemons stopped ----------
if (variant.plugin !== false) {
  const st = squeal("status");
  writeFileSync(join(OUT, "status-end.txt"), st.stdout + st.stderr);
}
const truthV = sh("npx", ["vitest", "run", "--reporter=json", `--outputFile=${join(OUT, "truth.vitest.json")}`], {
  check: false, env: { LEDGERLINE_CALENDAR_WARM: "1" }, timeout: 180_000,
});
const nodeFiles = existsSync(join(WORK, "scripts")) ? readdirSync(join(WORK, "scripts")).filter((f) => f.endsWith(".test.mjs")).map((f) => `scripts/${f}`) : [];
const truthN = nodeFiles.length ? sh("node", ["--test", ...nodeFiles], { check: false, timeout: 60_000 }) : { status: 0, stdout: "" };
writeFileSync(join(OUT, "truth.node.txt"), truthN.stdout + (truthN.stderr ?? ""));
writeFileSync(join(OUT, "truth.txt"), `vitest exit ${truthV.status}\nnode:test exit ${truthN.status}\n`);
const diff = sh("git", ["diff", "--stat"], { check: false }).stdout + "\n" + sh("git", ["status", "--short"], { check: false }).stdout + "\n" + sh("git", ["diff"], { check: false }).stdout;
writeFileSync(join(OUT, "diff.patch"), diff);
if (variant.plugin !== false) {
  const stop = squeal("stop", WORK);
  log(`daemon: ${(stop.stdout + stop.stderr).trim()}`);
  const store = join(WORK, ".git/squeal");
  if (existsSync(store)) {
    mkdirSync(join(OUT, "store"), { recursive: true });
    for (const f of readdirSync(store)) if (/^store\.sqlite/.test(f)) cpSync(join(store, f), join(OUT, "store", f));
  }
}
// Anything still running from this cell is ours: list it, then stop it.
const ps = spawnSync("pgrep", ["-af", CELL], { encoding: "utf8" }).stdout.split("\n").filter((l) => l && !l.includes("pgrep") && !l.includes("run-cell.mjs"));
if (ps.length) {
  log(`leftover processes: ${ps.length}`);
  appendFileSync(join(OUT, "leftovers.txt"), ps.join("\n") + "\n");
  for (const l of ps) { try { process.kill(Number(l.split(" ")[0]), "SIGTERM"); } catch {} }
}

const meta = {
  id, task, variant: variantName, harness, model, effort, rep: Number(rep), cold, head, pin: relative(ROOT, PIN),
  setupS: +setupS.toFixed(1), wallS: +((T1 - T0) / 1000).toFixed(1), exit,
  load: { start: samples[0], max: Math.max(...samples), mean: +(samples.reduce((a, b) => a + b, 0) / samples.length).toFixed(2), end: samples.at(-1) },
  harnessVersion: spawnSync(cmd, ["--version"], { encoding: "utf8", env }).stdout.trim(),
};
writeFileSync(join(OUT, "meta.json"), JSON.stringify(meta, null, 2));
const g = spawnSync("node", [join(HERE, "grade.mjs"), OUT], { encoding: "utf8" });
if (g.status !== 0) log(`grade failed: ${g.stderr}`);
else log(`graded: ${g.stdout.trim().split("\n").at(-1)}`);
