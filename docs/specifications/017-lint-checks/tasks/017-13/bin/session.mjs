#!/usr/bin/env node
// Throwaway probe for 017-13 (after 015-10 Part C's session.mjs). Not product code.
//   node session.mjs <id>     id: s1..s9 (saas) or v1..v9 (svelte), `r` suffix for a rerun
// One `claude -p` session on --model sonnet, as squeal-e2e (as-e2e.mjs), in the clone
// /home/squeal-e2e/runs/d1713/<repo>, with prompts/<id>.txt. Before it: the clone is reset to
// its base commit, a daemon is started and lint is waited for until nothing is pending, linting
// or stale (so the session registers at a settled state), and the session starts only at a
// one-minute load of 24 or below. During it: sampler.mjs (the daemon's per-thread CPU and RSS)
// and snap.mjs (every version of every written file). Stream-json with hook events, each line
// stamped with epoch ms. 60 s after the `result` event, or at 15 min, the session gets SIGTERM
// (only this script's own child). After it: lint settles again, then the diff, `squeal lint`,
// `squeal lint --changed --json`, the store's transitions and revisions since the start, the
// states of changed files and the transcript. One session per clone: locks/<repo>.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const [id] = process.argv.slice(2);
if (!/^[sv][1-9]r?$/.test(id ?? "")) {
  console.error("usage: session.mjs <s1..s9|v1..v9>[r]");
  process.exit(2);
}
const repo = id.startsWith("s") ? "saas" : "svelte";
// saas: lint each file with its nearest config, as `nx lint` does (lessons.md, open question 4).
// Every command below inherits it, the session's own and so the daemon its hooks start.
if (repo === "saas") process.env.E2E_VAR_ESLINT_FLAGS = "v10_config_lookup_from_file";
const here = dirname(fileURLToPath(import.meta.url));
const W = "/tmp/dogfood-017-13/w-4a90e840";
const BIN = `${W}/bin`; // a copy of this folder squeal-e2e can read
const R = "/home/squeal-e2e/runs/d1713";
const CWD = `${R}/${repo}`;
const BASE = JSON.parse(readFileSync(join(W, "bases.json"), "utf8"))[repo];
mkdirSync(join(W, "locks"), { recursive: true });
try {
  mkdirSync(join(W, "locks", repo));
} catch {
  console.error(`refused: a session already runs in ${repo} (locks/${repo})`);
  process.exit(3);
}
process.on("exit", () => rmSync(join(W, "locks", repo), { recursive: true, force: true }));
const out = join(W, "logs", "sessions", id);
mkdirSync(out, { recursive: true });
const task = readFileSync(join(here, "..", "prompts", `${id.replace(/r$/, "")}.txt`), "utf8").trim();
const meta = { id, repo, base: BASE, gate: [] };
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const as = (args, extra = {}) =>
  execFileSync("node", [join(here, "as-e2e.mjs"), R, CWD, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 1 << 28, ...extra });
const tryAs = (args) => {
  try {
    return as(args);
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}(exit ${e.status})`;
  }
};
const store = (...args) => tryAs(["node", "--no-warnings", `${BIN}/store.mjs`, ...args]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const lintNow = () => {
  try {
    return JSON.parse(as(["squeal", "status", "--json"])).lint ?? null;
  } catch {
    return null;
  }
};
// Settled: lint keyed the latest revision, and nothing is linting, pending or stale. A status
// read right after an edit can still show the state before it, so the cursor is checked too.
const cursor = () => {
  try {
    return JSON.parse(store("cursor").trim().split("\n").at(-1));
  } catch {
    return null;
  }
};
// A daemon exits 3 s after its last session ends, with lint work left pending (v1): after a
// session, settle(…, true) starts one again at each read.
const settle = async (limitMs, keepAlive = false) => {
  const t = Date.now();
  let lint = null;
  let c = null;
  let quiet = 0;
  while (Date.now() - t < limitMs) {
    if (keepAlive) tryAs(["squeal", "start"]);
    lint = lintNow();
    c = cursor();
    const keyed = c !== null && c.cursor.length > 0 && c.cursor.every((r) => r === c.latest);
    const clean = lint && !lint.linting && lint.pending === 0 && lint.stale === 0;
    quiet = clean ? quiet + 1 : 0;
    // A revision that changes no linted file may leave the cursor behind: then 5 clean reads in a row.
    if (clean && (keyed || quiet >= 5)) return { s: (Date.now() - t) / 1000, lint, cursor: c, keyed };
    await sleep(2000);
  }
  return { s: null, lint, cursor: c };
};

// Reset the clone to its base; start a daemon and let lint settle there.
tryAs(["git", "reset", "-q", "--hard", BASE]);
tryAs(["git", "clean", "-fdq"]);
tryAs(["git", "checkout", "-q", "dogfood"]);
meta.startOut = tryAs(["squeal", "start"]).trim().split("\n").slice(-2).join(" | ");
tryAs(["squeal", "status", "--wait", "30000"]);
meta.settleBefore = await settle(10 * 60000);
writeFileSync(join(out, "lint-before.txt"), tryAs(["squeal", "lint"]));
const lastTransition = store("transitions").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).at(-1)?.id ?? 0;
const lastRevision = store("revisions").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).at(-1)?.number ?? 0;
meta.since = { transition: lastTransition, revision: lastRevision };

while (load1() > 24) {
  meta.gate.push({ at: new Date().toISOString(), load1: load1() });
  await sleep(30000);
}
const sampler = spawn("node", [join(here, "sampler.mjs"), join(out, "samples.jsonl"), CWD, "250"], { stdio: "ignore" });
const snapDir = `${R}/snap/${id}`;
tryAs(["rm", "-rf", snapDir]);
const snap = spawn("node", [join(here, "as-e2e.mjs"), R, CWD, "node", `${BIN}/snap.mjs`, snapDir], { cwd: "/", stdio: "ignore" });
await sleep(3000);
meta.loadAtStart = load1();
meta.start = new Date().toISOString();
const t0 = Date.now();
meta.t0 = t0;

const args = [
  join(here, "as-e2e.mjs"), R, CWD,
  "claude", "-p", task, "--model", "sonnet", "--output-format", "stream-json", "--verbose",
  "--include-hook-events", "--permission-mode", "bypassPermissions",
];
const child = spawn("node", args, {
  cwd: "/",
  env: { ...process.env, E2E_PRESERVE: "ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN", E2E_NODE: "24" },
  stdio: ["ignore", "pipe", "pipe"],
});
const stream = createWriteStream(join(out, "stream.jsonl"));
const errs = createWriteStream(join(out, "stderr.txt"));
let buf = "";
let resultAt = null;
const loads = [];
const loadTimer = setInterval(() => loads.push({ t: Date.now() - t0, load1: load1() }), 30000);
child.stdout.on("data", (chunk) => {
  buf += chunk;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    stream.write(`${Date.now()} ${line}\n`);
    try {
      const ev = JSON.parse(line);
      if (ev.type === "system" && ev.subtype === "init") meta.sessionId = ev.session_id;
      if (resultAt === null && ev.type === "result") {
        resultAt = Date.now();
        setTimeout(() => child.kill("SIGTERM"), 60000).unref();
      }
    } catch {}
  }
});
child.stderr.pipe(errs);
const hard = setTimeout(() => {
  meta.killedAtLimit = true;
  child.kill("SIGTERM");
}, 15 * 60000);
const code = await new Promise((r) => child.on("exit", (c, s) => r(c ?? s)));
clearTimeout(hard);
clearInterval(loadTimer);
meta.exit = code;
meta.wallS = (Date.now() - t0) / 1000;
meta.resultS = resultAt === null ? null : (resultAt - t0) / 1000;
meta.loadAtEnd = load1();
meta.loads = loads;
// Keep the daemon alive while lint settles: it exits a few seconds after its last session.
meta.settleAfter = await settle(10 * 60000, true);
sampler.kill("SIGTERM");
snap.kill("SIGTERM");
writeFileSync(join(out, "diff.patch"), tryAs(["git", "diff", BASE]));
writeFileSync(join(out, "status-after.txt"), tryAs(["git", "status", "--short"]));
const changed = tryAs(["git", "diff", "--name-only", BASE]).split("\n").filter(Boolean);
const untracked = tryAs(["git", "ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean);
meta.changed = [...changed, ...untracked];
writeFileSync(join(out, "lint-after.txt"), tryAs(["squeal", "lint"]));
writeFileSync(join(out, "lint-changed.json"), tryAs(["squeal", "lint", "--changed", "--json"]));
const code0 = meta.changed.filter((p) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs|svelte)$/.test(p));
if (code0.length > 0) {
  writeFileSync(join(out, "lint-after-paths.json"), tryAs(["squeal", "lint", ...code0, "--json"]));
  writeFileSync(join(out, "states.jsonl"), store("states", ...code0));
}
writeFileSync(join(out, "transitions.jsonl"), store("transitions", String(lastTransition)));
writeFileSync(join(out, "revisions.jsonl"), store("revisions", String(lastRevision)));
writeFileSync(join(out, "squeal-status-after.txt"), tryAs(["squeal", "status", "--full"]));
writeFileSync(join(out, "snap-log.jsonl"), tryAs(["cat", `${snapDir}/log.jsonl`]));
if (meta.sessionId) {
  const slug = CWD.replace(/[^a-zA-Z0-9]/g, "-");
  writeFileSync(join(out, "transcript.jsonl"), tryAs(["cat", `${R}/claude/projects/${slug}/${meta.sessionId}.jsonl`]));
}
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
console.log(JSON.stringify({ id, start: meta.start, loadAtStart: meta.loadAtStart, wallS: meta.wallS, exit: code, changed: meta.changed }));
