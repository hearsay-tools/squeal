// Q3 (throwaway): what a fresh oxlint run does when a JS plugin hangs, throws
// or exits, and whether a kill leaves a child behind (tsgolint). Each case runs
// `oxlint --format json` in its own process group with a guard; on the guard
// the group gets SIGKILL. Usage: node contain.mjs <scratch> <toolDir> <typedProject> <tsgolint>
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const [scratch, toolDir, typedProject, tsgolint] = process.argv.slice(2);
const W = path.join(scratch, "contain");
fs.rmSync(W, { recursive: true, force: true });
fs.mkdirSync(path.join(W, "src"), { recursive: true });
fs.symlinkSync(path.join(toolDir, "node_modules"), path.join(W, "node_modules"));
fs.writeFileSync(path.join(W, ".gitignore"), "node_modules\n");
execFileSync("git", ["init", "-q", W]);
fs.writeFileSync(path.join(W, "src/a.js"), "export const a = 1;\n");
const plugin = (body) => `export default { meta: { name: "bad" }, rules: { r: { create(context) { ${body} return {}; } } } };\n`;
fs.writeFileSync(path.join(W, "hang.mjs"), plugin("Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60000);"));
fs.writeFileSync(path.join(W, "throw.mjs"), plugin('throw new Error("rule exploded");'));
fs.writeFileSync(path.join(W, "exit.mjs"), plugin("process.exit(7);"));
fs.writeFileSync(path.join(W, "async-throw.mjs"), plugin('setTimeout(() => { throw new Error("late"); }, 0);'));
const cfg = (p) => JSON.stringify({ jsPlugins: [`./${p}.mjs`], rules: { "bad/r": "error" } });

function run(cwd, args, guardMs, env = {}, groupKill = true) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const c = spawn(process.execPath, [path.join(toolDir, "node_modules/oxlint/bin/oxlint"), ...args], { cwd, detached: true, env: { ...process.env, ...env } });
    let out = "", err = "", killed = false;
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => {
      killed = true;
      // Who is in the group before the kill: oxlint and any child it started.
      const members = execFileSync("ps", ["-o", "pid=,comm=", "-g", String(c.pid)], { encoding: "utf8" }).trim().split("\n").map((s) => s.trim());
      process.kill(groupKill ? -c.pid : c.pid, "SIGKILL");
      c.groupBefore = members;
    }, guardMs);
    c.on("exit", (code, signal) => {
      clearTimeout(timer);
      setTimeout(() => {
        let left = "";
        try { left = execFileSync("ps", ["-o", "pid=,comm=", "-g", String(c.pid)], { encoding: "utf8" }).trim(); } catch { left = ""; }
        // Clean up what a pid-only kill left behind.
        try { process.kill(-c.pid, "SIGKILL"); } catch {}
        resolve({ code, signal, killed, wallMs: Math.round(performance.now() - t0), groupBefore: c.groupBefore ?? null, leftAfter: left || "none", out: out.slice(0, 300), err: err.slice(0, 300) });
      }, 300);
    });
  });
}

const results = {};
for (const p of ["hang", "throw", "exit", "async-throw"]) {
  fs.writeFileSync(path.join(W, ".oxlintrc.json"), cfg(p));
  results[p] = await run(W, ["--format", "json"], 5000);
}
// A kill while tsgolint works: the typed project, killed 400 ms in, by group
// and by pid alone. The hang is a sleeping block (Atomics.wait): no CPU burnt.
results["kill-group-during-type-aware"] = await run(typedProject, ["--format", "json", "-c", "ta.json"], 400, { OXLINT_TSGOLINT_PATH: tsgolint });
results["kill-pid-only-during-type-aware"] = await run(typedProject, ["--format", "json", "-c", "ta.json"], 400, { OXLINT_TSGOLINT_PATH: tsgolint }, false);
fs.writeFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), "out/contain.json"), JSON.stringify(results, null, 1));
console.log(JSON.stringify(results, null, 1));
