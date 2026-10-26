// Probe: the order in which the parent node --test handles its child's death and its own SIGTERM.
// mode "group": SIGTERM the group. mode "stopped": SIGSTOP the parent, SIGTERM the group, then
// SIGCONT, as a descheduled parent on a loaded host. mode "child": SIGTERM the child only, then
// the group after `delayMs`.
import { spawn, execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, mkdirSync, openSync, closeSync } from "node:fs";
import { join } from "node:path";
const [reporter, fx, mode, n = "10", delayMs = "0"] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const counts = {};
for (let i = 0; i < Number(n); i++) {
  const log = join(fx, "..", "logs", `${mode}-${i}`);
  rmSync(log, { recursive: true, force: true });
  mkdirSync(log, { recursive: true });
  const marker = join(fx, "holds.started");
  rmSync(marker, { force: true });
  const out = openSync(join(log, "stdout.log"), "a");
  const err = openSync(join(log, "stderr.log"), "a");
  const child = spawn(process.execPath, ["--test", `--test-reporter=${reporter}`, `--test-reporter-destination=${join(log, "events.ndjson")}`, "test/cut.test.mjs"], { cwd: fx, detached: true, stdio: ["ignore", out, err] });
  closeSync(out); closeSync(err);
  const exited = new Promise((r) => child.once("exit", (code, signal) => { try { process.kill(-child.pid, "SIGKILL"); } catch {} r({ code, signal }); }));
  while (!existsSync(marker)) await sleep(20);
  if (mode === "group") process.kill(-child.pid, "SIGTERM");
  else if (mode === "stopped") {
    process.kill(child.pid, "SIGSTOP");
    process.kill(-child.pid, "SIGTERM");
    await sleep(Number(delayMs));
    process.kill(child.pid, "SIGCONT");
  } else {
    const kid = Number(execFileSync("pgrep", ["-P", String(child.pid)], { encoding: "utf8" }).trim().split("\n")[0]);
    process.kill(kid, "SIGTERM");
    await sleep(Number(delayMs));
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // the parent already ended on its own after its child's death
    }
  }
  const exit = await exited;
  const events = readFileSync(join(log, "events.ndjson"), "utf8").split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const wrapper = events.find((e) => e.type === "test:complete" && e.data.nesting === 0 && e.data.name === "test/cut.test.mjs" && e.data.entryFile === undefined);
  const summary = events.some((e) => e.type === "test:summary" && e.data.file === null);
  const key = `exit=${exit.code}/${exit.signal} wrapper=${wrapper ? wrapper.data.details?.passed : "none"} summary=${summary} types=${events.map((e) => e.type.replace("test:", "")).join(",")}`;
  counts[key] = (counts[key] ?? 0) + 1;
}
console.log(mode, delayMs, JSON.stringify(counts, null, 1));
