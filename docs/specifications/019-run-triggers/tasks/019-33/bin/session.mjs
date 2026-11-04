#!/usr/bin/env node
// Throwaway probe for 019-33 (Round 2), after 019-17's session.mjs. Not product code. Runs as agent.
//   node session.mjs <id>
// One agent session as squeal-e2e (019-17's as-e2e.mjs) in a clone of /home/squeal-e2e/runs/d1933,
// with prompts/<prompt>.txt. Before it: the clone is reset to its variant's commit (bases.json),
// its daemon stopped and its store removed (every Round 2 session runs on a new store), the
// session's `pre` state written (s2: an untracked notes.md and a partly staged src/math.ts), a
// daemon started and settled (the fixture: `squeal run --all --wait`; cezarion: `squeal status
// --wait 90000`, which returns at its bound with the unit baseline still queued: the backlog is
// part of what s1c and s4 measure), and the session starts only at a one-minute load of 24 or
// below. Then the daemon's RSS and V8 heap (mem.mjs --heap), a 5 s RSS sampler, and the harness:
// `claude -p --model sonnet` with stream-json and hook events, or `codex exec --json -m
// gpt-6-astra`; the daemon's memory again at the session's result, before it can exit. Each
// stream line is stamped with epoch ms. After it: status, the store's runs, revisions and meta
// rows since the start, the diff and git status, the Codex rollout, and timeline.txt. One session
// per clone at a time: locks/<repo>. Round 1's interrupt code is kept, unused by Round 2.
import { execFileSync, spawn } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SESSIONS = {
  // (1) the commit is the last tool call, and it adds a lint finding (P1, P2, P4).
  s1f: { variant: "fix-h1", harness: "claude", prompt: "s1f" },
  s1c: { variant: "cez-groups", harness: "claude", prompt: "s1c" },
  // (2) the same beside an untracked notes file and a partly staged src/math.ts (P4).
  s2: { variant: "fix-h1", harness: "claude", prompt: "s2", pre: "partial" },
  // (3) Stop waits for the e2e group: maxHolds 1, then 2 (P3, P6).
  s3a: { variant: "fix-h1", harness: "claude", prompt: "s3" },
  s3b: { variant: "fix-h2", harness: "claude", prompt: "s3" },
  // (3) with maxHolds 1 and a prompt that forbids running tests but not squeal commands: does
  // the last hold's line make the agent check its fix (P6)?
  s3c: { variant: "fix-h1", harness: "claude", prompt: "s3c" },
  // s3b again: how often the first Stop's hold comes without a wait (P3) in Claude Code.
  s3b2: { variant: "fix-h2", harness: "claude", prompt: "s3" },
  s3b3: { variant: "fix-h2", harness: "claude", prompt: "s3" },
  s3b4: { variant: "fix-h2", harness: "claude", prompt: "s3" },
  // (4) cezarion: Stop for its e2e group behind its unit backlog (P5).
  s4: { variant: "cez-groups", harness: "claude", prompt: "s4" },
  // (5) Codex, as (3) with maxHolds 2 (Round 1's x2), and with maxHolds 1.
  s5: { variant: "fix-h2", harness: "codex", prompt: "s3" },
  s5b: { variant: "fix-h1", harness: "codex", prompt: "s3" },
};
const [id] = process.argv.slice(2);
const s = SESSIONS[id];
if (s === undefined) {
  console.error(`usage: session.mjs <${Object.keys(SESSIONS).join("|")}>`);
  process.exit(2);
}
const here = dirname(fileURLToPath(import.meta.url));
const r1 = join(here, "..", "..", "019-17", "bin");
const W = "/tmp/dogfood-019-33";
const R = "/home/squeal-e2e/runs/d1933";
const base = JSON.parse(readFileSync(join(W, "bases.json"), "utf8"))[s.variant];
const CWD = `${R}/${base.repo}`;
mkdirSync(join(W, "locks"), { recursive: true });
try {
  mkdirSync(join(W, "locks", base.repo));
} catch {
  console.error(`refused: a session already runs in ${base.repo}`);
  process.exit(3);
}
process.on("exit", () => rmSync(join(W, "locks", base.repo), { recursive: true, force: true }));
const out = join(W, "logs", "sessions", id);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const task = readFileSync(join(here, "..", "prompts", `${s.prompt}.txt`), "utf8").trim();
const meta = { id, ...s, base, gate: [] };
const load1 = () => Number(readFileSync("/proc/loadavg", "utf8").split(" ")[0]);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const as = (args) =>
  execFileSync("node", [join(r1, "as-e2e.mjs"), R, CWD, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1 << 28,
  });
const tryAs = (args) => {
  try {
    return as(args);
  } catch (e) {
    return `${e.stdout ?? ""}${e.stderr ?? ""}(exit ${e.status})`;
  }
};
const mem = (heap) => {
  try {
    return JSON.parse(execFileSync("node", [join(r1, "mem.mjs"), CWD, ...(heap ? ["--heap"] : [])], { encoding: "utf8" }));
  } catch (e) {
    return { error: String(e) };
  }
};

// Reset to the variant's commit; start and settle a daemon there.
tryAs(["git", "checkout", "-q", "-f", base.branch]);
tryAs(["git", "reset", "-q", "--hard", base.commit]);
tryAs(["git", "clean", "-fdq"]);
meta.stopOut = tryAs(["squeal", "stop"]).trim();
tryAs(["rm", "-rf", ".git/squeal"]);
if (s.pre === "partial") {
  // An untracked notes file no key reads, and src/math.ts with one hunk staged (a new `sub`)
  // and one left unstaged (a comment at the top). The math tests read src/math.ts.
  const staged = "export const add = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\nexport const sub = (a: number, b: number) => a - b;\n";
  const write = (path, text) => as(["node", "-e", "require('fs').writeFileSync(process.argv[1], process.argv[2])", path, text]);
  write("notes.md", "# Notes\n\n- isLoud: use it in shout later\n");
  write("src/math.ts", staged);
  as(["git", "add", "src/math.ts"]);
  write("src/math.ts", `// TODO: div\n${staged}`);
  meta.preStatus = tryAs(["git", "status", "--short"]);
}
meta.startOut = tryAs(["squeal", "start"]).trim().split("\n").slice(-1)[0];
// cezarion's whole unit baseline takes over an hour here; on a new store the settle only lets the
// daemon list its files and start the baseline, which stays queued behind the session.
const settleArgs = base.repo === "fixture" ? ["run", "--all", "--wait", "600000"] : ["status", "--wait", "90000"];
const settled0 = Date.now();
writeFileSync(join(out, "settle-before.txt"), tryAs(["squeal", ...settleArgs]));
meta.settleBeforeS = (Date.now() - settled0) / 1000;
writeFileSync(join(out, "status-before.txt"), tryAs(["squeal", "status"]));
while (load1() > 24) {
  meta.gate.push({ at: new Date().toISOString(), load1: load1() });
  await sleep(30000);
}
meta.memStart = mem(true);
rmSync(join(out, "mem.stop"), { force: true });
const sampler = spawn("sh", [join(here, "memloop.sh"), CWD, join(out, "mem.jsonl"), join(out, "mem.stop")], { stdio: "ignore" });
meta.loadAtStart = load1();
meta.start = new Date().toISOString();
const t0 = Date.now();
meta.t0 = t0;

const claudeArgs = ["claude", "-p", ...(s.interrupt ? [] : [task]), "--model", "sonnet", "--output-format", "stream-json", "--verbose", "--include-hook-events", "--permission-mode", "bypassPermissions", ...(s.interrupt ? ["--input-format", "stream-json"] : [])];
const codexArgs = ["codex", "exec", "--json", "-s", "danger-full-access", "-m", "gpt-6-astra", "-c", 'model_reasoning_effort="medium"', task];
const child = spawn("node", [join(r1, "as-e2e.mjs"), R, CWD, ...(s.harness === "codex" ? codexArgs : claudeArgs)], {
  cwd: "/",
  env: {
    ...process.env,
    E2E_PRESERVE: s.harness === "codex" ? "CLIPROXY_API_KEY,CODEX_CA_CERTIFICATE" : "ANTHROPIC_BASE_URL,ANTHROPIC_AUTH_TOKEN",
    E2E_NODE: "24",
  },
  stdio: ["pipe", "pipe", "pipe"],
});
const send = (obj) => child.stdin.write(`${JSON.stringify(obj)}\n`);
const ask = (text) => send({ type: "user", message: { role: "user", content: [{ type: "text", text }] } });
if (s.interrupt) ask(task);
else child.stdin.end();
const stream = createWriteStream(join(out, "stream.jsonl"));
child.stderr.pipe(createWriteStream(join(out, "stderr.txt")));
let buf = "";
let results = 0;
let interrupted = false;
const loads = [];
const loadTimer = setInterval(() => loads.push({ t: Date.now() - t0, load1: load1() }), 30000);
child.stdout.on("data", (chunk) => {
  buf += chunk;
  for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
    const line = buf.slice(0, i);
    buf = buf.slice(i + 1);
    stream.write(`${Date.now()} ${line}\n`);
    let ev;
    try {
      ev = JSON.parse(line);
    } catch {
      continue;
    }
    if (ev.type === "system" && ev.subtype === "init") meta.sessionId = ev.session_id;
    if (ev.type === "thread.started") meta.sessionId = ev.thread_id;
    const bash = ev.type === "assistant" && (ev.message?.content ?? []).some((c) => c.type === "tool_use" && c.name === "Bash");
    if (s.interrupt && bash && !interrupted) {
      interrupted = true;
      setTimeout(() => {
        meta.interruptAt = Date.now() - t0;
        if (s.interrupt === "sdk") send({ type: "control_request", request_id: "dogfood-interrupt", request: { subtype: "interrupt" } });
        // as-e2e.mjs passes SIGINT to sudo, which relays it to the harness.
        else child.kill("SIGINT");
      }, 5000);
    }
    // The daemon exits seconds after the session ends: its end memory is read at the result.
    if (ev.type === "result" || ev.type === "turn.completed") meta.memEnd = mem(true);
    if (ev.type === "result") {
      results += 1;
      if (s.interrupt && results === 1 && s.interrupt === "sdk") ask("What happened to your last command? Answer in one sentence, then stop.");
      else setTimeout(() => child.stdin.end(), 1000);
    }
  }
});
const hard = setTimeout(() => {
  meta.killedAtLimit = true;
  child.kill("SIGTERM");
}, 25 * 60000);
const code = await new Promise((r) => child.on("exit", (c, sig) => r(c ?? sig)));
clearTimeout(hard);
clearInterval(loadTimer);
meta.exit = code;
meta.wallS = (Date.now() - t0) / 1000;
meta.loadAtEnd = load1();
meta.loads = loads;
meta.memAfter = mem(false);
writeFileSync(join(out, "mem.stop"), "");
sampler.kill("SIGTERM");
writeFileSync(join(out, "status-after.txt"), tryAs(["squeal", "status", "--full"]));
writeFileSync(join(out, "store.json"), tryAs(["node", `${W}/bin/store.mjs`, CWD, String(t0 - 60000)]));
writeFileSync(join(out, "diff.patch"), tryAs(["git", "diff", base.commit]));
writeFileSync(join(out, "log.txt"), tryAs(["git", "log", "--stat", "--format=%h %s", `${base.commit}..HEAD`]));
writeFileSync(join(out, "git-status.txt"), tryAs(["git", "status", "--short"]));
if (s.harness === "codex") {
  const rollout = tryAs(["sh", "-c", `ls -t $(find ${R}/codex/sessions -name 'rollout-*.jsonl' -newermt @${Math.floor(t0 / 1000)}) | head -1`]).trim();
  if (rollout.startsWith("/")) writeFileSync(join(out, "codex-rollout.jsonl"), tryAs(["cat", rollout]));
}
writeFileSync(join(out, "meta.json"), `${JSON.stringify(meta, null, 2)}\n`);
writeFileSync(join(out, "timeline.txt"), execFileSync("node", [join(r1, "timeline.mjs"), out], { encoding: "utf8", maxBuffer: 1 << 26 }));
console.log(JSON.stringify({ id, start: meta.start, loadAtStart: meta.loadAtStart, wallS: meta.wallS, exit: code, memStart: meta.memStart, memEnd: meta.memEnd }));
