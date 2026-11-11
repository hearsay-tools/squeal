// Throwaway issue 181 probe. Runs only isolated fixture files, never the repository suite.
// Usage: node probe.mjs <evidence-dir> [--control]
//   default: a 30 s edited file runs; a new failing test file is added; named wait + direct run.
//   --control: same new file, no run in flight.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { cpus, loadavg, tmpdir } from "node:os";
import { join, resolve } from "node:path";

const control = process.argv.includes("--control");
const output = resolve(process.argv[2]);
mkdirSync(output, { recursive: true });
const cli = "/home/agent/.codex/plugins/data/squeal-hearsay/versions/0.1.429/dist/cli/squeal.mjs";
const root = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), "sq-181-"));
const runtime = join(root, ".runtime");
mkdirSync(runtime);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(VITEST|GIT_|CODEX_|CEZ_|CLAUDE|SQUEAL)/.test(k) && !["NODE_OPTIONS", "NODE_PATH"].includes(k),
  ),
);
env.XDG_RUNTIME_DIR = runtime;
env.XDG_CONFIG_HOME = join(runtime, "config");
const start = Date.now();
const events = [];
function event(name, data = {}) {
  const e = { ms: Date.now() - start, name, ...data };
  events.push(e);
  console.log(JSON.stringify(e));
  writeFileSync(join(output, "events.json"), `${JSON.stringify(events, null, 2)}\n`);
}
const machine = { at: new Date().toISOString(), load: loadavg(), cpus: cpus().length, node: process.version, cli, root, control };
event("host", machine);
if (machine.load[0] > machine.cpus) throw new Error("Load above CPU count: live reproduction skipped");
function sync(exe, args) {
  const r = spawnSync(exe, args, { cwd: root, env, encoding: "utf8", timeout: 10000 });
  if (r.status !== 0) throw new Error(r.stderr || r.stdout);
  return r.stdout;
}
function run(args, exe = process.execPath, pre = ["--disable-warning=ExperimentalWarning", cli]) {
  const t0 = Date.now();
  const p = spawn(exe, [...pre, ...args], { cwd: root, env });
  let stdout = "", stderr = "";
  p.stdout.on("data", (d) => (stdout += d));
  p.stderr.on("data", (d) => (stderr += d));
  const done = new Promise((r) => p.on("exit", (code, signal) => r({ code, signal, stdout, stderr, ms: Date.now() - t0 })));
  return { p, done };
}
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const test = (name, ms, pass = true) =>
  `import {it,expect} from 'vitest';\nit('${name}',async()=>{await new Promise(r=>setTimeout(r,${ms}));expect(${pass ? 1 : 2}).toBe(1)});\n`;
writeFileSync(join(root, "package.json"), JSON.stringify({ name: "issue-181-probe", private: true, type: "module" }));
symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
writeFileSync(join(root, ".gitignore"), "node_modules/\n.runtime/\n");
writeFileSync(join(root, "vitest.config.ts"), `export default {test:{include:['*.test.ts'],maxWorkers:2,testTimeout:60000}};\n`);
writeFileSync(
  join(root, "squeal.config.json"),
  JSON.stringify({
    baseline: { onStart: "lookup-only" },
    runner: { tierSize: 2, backlogTierSize: 4, timeoutMs: 60000 },
    coverage: { enabled: false },
    complexity: { enabled: false },
  }),
);
writeFileSync(join(root, "fast.test.ts"), test("fast", 50));
writeFileSync(join(root, "slow.test.ts"), test("slow", 30000));
sync("git", ["init", "-q"]);
sync("git", ["add", "."]);
sync("git", ["-c", "user.name=Research probe", "-c", "user.email=probe@example.invalid", "commit", "-qm", "fixture"]);
event("version", {
  version: sync(process.execPath, [cli, "--version"]).trim(),
  vitest: JSON.parse(readFileSync(join(root, "node_modules/vitest/package.json"), "utf8")).version,
});
const daemon = run(["daemon", root]);
async function status(label, args) {
  const r = await run(["status", ...args]).done;
  writeFileSync(join(output, `${label}.out`), r.stdout + (r.stderr ? `\n--- stderr\n${r.stderr}` : ""));
  event(label, { code: r.code, ms: r.ms });
  return r;
}
try {
  for (let i = 0; ; i++) {
    await pause(500);
    const r = await run(["status", "--json"]).done;
    try {
      const v = JSON.parse(r.stdout);
      if (v.testFileCounts && Object.values(v.testFileCounts).reduce((a, b) => a + b, 0) >= 2) break;
    } catch {}
    if (i > 60) throw new Error("fixture not listed in 30 s");
  }
  event("listed");
  if (!control) {
    writeFileSync(join(root, "slow.test.ts"), `${test("slow", 30000)}// edit\n`);
    event("edit-slow");
    for (let i = 0; ; i++) {
      await pause(250);
      const r = await run(["status", "--json", "slow.test.ts"]).done;
      if (/"running"|running since/.test(r.stdout)) break;
      if (i > 80) throw new Error("slow not running in 20 s");
    }
    event("slow-running");
  }
  writeFileSync(join(root, "blocked-switch.test.ts"), test("blocked-switch", 50, false));
  event("new-file-written");
  const named = run(["status", "--wait", "15000", "blocked-switch.test.ts"]);
  const direct = run(["run", "blocked-switch.test.ts"], join(root, "node_modules/.bin/vitest"), []);
  const d = await direct.done;
  writeFileSync(join(output, "direct.out"), d.stdout + d.stderr);
  event("direct-run", { code: d.code, ms: d.ms });
  await status("mid-json", ["--json", "blocked-switch.test.ts"]);
  const n = await named.done;
  writeFileSync(join(output, "named-wait.out"), n.stdout + (n.stderr ? `\n--- stderr\n${n.stderr}` : ""));
  event("named-wait", { code: n.code, ms: n.ms });
  await status("after-wait-json", ["--json", "blocked-switch.test.ts"]);
  const f = run(["status", "--wait", "60000", "blocked-switch.test.ts"]);
  const fr = await f.done;
  writeFileSync(join(output, "final-wait.out"), fr.stdout + fr.stderr);
  event("final-wait", { code: fr.code, ms: fr.ms });
} finally {
  const stopped = await run(["stop", root]).done;
  event("stop", { code: stopped.code });
  const ended = await Promise.race([daemon.done, pause(10000).then(() => null)]);
  if (!ended) { daemon.p.kill("SIGTERM"); event("daemon-forced-stop"); }
  else { writeFileSync(join(output, "daemon.log"), ended.stdout + ended.stderr); event("daemon-exit", { code: ended.code }); }
}
