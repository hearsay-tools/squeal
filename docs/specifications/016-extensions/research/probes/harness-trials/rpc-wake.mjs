// Throwaway probe (016-35). Run as squeal-e2e, cwd ~/ht035/repo, with the fake
// model listening. Usage: node rpc-wake.mjs <frames.jsonl> <omp args...>
// Starts `omp --mode rpc <args>`, sends one prompt ($HT_PROMPT, default "Break
// then fix sum.js"), waits for session_settled, then (unless HT_NO_OUTSIDE=1)
// breaks sum.js from outside the session, and watches $HT_IDLE_MS (default
// 40 s) for an agent_start no prompt asked for: the idle wake. Then closes
// stdin and waits for omp to exit. Every frame is logged.
import { spawn } from "node:child_process";
import { appendFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const [framesPath, ...args] = process.argv.slice(2);
const log = (o) => appendFileSync(framesPath, `${JSON.stringify({ at: new Date().toISOString(), ...o })}\n`);
const omp = spawn("omp", ["--mode", "rpc", ...args], { stdio: ["pipe", "pipe", "inherit"] });
let settled = 0;
let broke = false;
let wakes = 0;
createInterface({ input: omp.stdout }).on("line", (line) => {
  let f;
  try { f = JSON.parse(line); } catch { log({ raw: line.slice(0, 300) }); return; }
  const brief = { type: f.type, command: f.command, status: f.status };
  if (f.type === "message_end") brief.message = JSON.stringify(f.message?.content).slice(0, 400);
  log(brief);
  if (f.type === "ready") omp.stdin.write(`${JSON.stringify({ id: "p1", type: "prompt", message: process.env.HT_PROMPT || "Break then fix sum.js" })}\n`);
  if (f.type === "agent_start" && broke) wakes++;
  // r2 got prompt_result but never session_settled; 10 s later the idle stage starts anyway.
  if (f.type === "prompt_result") setTimeout(() => { if (!broke) { log({ probe: "no session_settled 10 s after prompt_result" }); idle(); } }, 10_000);
  if (f.type === "session_settled") {
    settled++;
    idle();
  }
});
function idle() {
  if (!broke) {
    broke = true;
    setTimeout(() => {
      if (process.env.HT_NO_OUTSIDE !== "1") {
        writeFileSync("sum.js", "export const sum = (a, b) => a - b; // outside edit\n");
        log({ probe: "broke sum.js from outside the session" });
      }
      setTimeout(() => { log({ probe: "closing stdin", wakes, settled }); omp.stdin.end(); }, Number(process.env.HT_IDLE_MS || 40_000));
    }, 2_000);
  }
}
omp.on("exit", (code) => { log({ probe: "omp exit", code, wakes }); process.exit(0); });
