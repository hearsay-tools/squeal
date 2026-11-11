import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

/*
 * Review 0.1.432 B1: a `prepare` command that keeps running and writing
 * until something kills it. It starts an ordinary descendant, in the
 * command's process group, and both write their PID, then append to a file
 * of their own every 25 ms. `prepare-cancel.test.ts` and the CLI's
 * `code-gate-prepare-cancel.test.ts` cancel the gate while it runs.
 */

/** The command's script, run as `node prepare.cjs` in the directory it writes to. */
export const PREPARE_SCRIPT = `const fs = require("node:fs");
const { spawn } = require("node:child_process");
const descendant = 'const fs = require("node:fs"); fs.writeFileSync("child.pid", String(process.pid)); setInterval(() => fs.appendFileSync("child.beat", "."), 25);';
spawn(process.execPath, ["-e", descendant], { stdio: "ignore" });
fs.writeFileSync("prepare.pid", String(process.pid));
setInterval(() => fs.appendFileSync("prepare.beat", "."), 25);
`;

/** The PID a file of `dir` holds; `null` until it holds a whole one. */
function pidIn(dir: string, name: string): number | null {
  const path = join(dir, name);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, "utf8");
  return /^\d+$/.test(text) ? Number(text) : null;
}

/** The command's PID and its descendant's, once both wrote them; rejects after `timeoutMs`. */
export async function pidsOf(
  dir: string,
  timeoutMs: number,
): Promise<{ readonly prepare: number; readonly child: number }> {
  const until = performance.now() + timeoutMs;
  while (performance.now() < until) {
    const [prepare, child] = [pidIn(dir, "prepare.pid"), pidIn(dir, "child.pid")];
    if (prepare !== null && child !== null) return { prepare, child };
    await delay(20);
  }
  throw new Error(`the prepare command and its descendant did not start within ${timeoutMs} ms`);
}

/** Whether `pid` runs: it exists and is not a zombie that waits for its parent. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  if (!existsSync("/proc/self/stat")) return true;
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z";
  } catch {
    return false;
  }
}

/** Whether neither `pids` runs within `timeoutMs`: a killed process can take a moment to be reaped. */
export async function gone(pids: readonly number[], timeoutMs = 5_000): Promise<boolean> {
  const until = performance.now() + timeoutMs;
  while (pids.some(alive)) {
    if (performance.now() > until) return false;
    await delay(20);
  }
  return true;
}

/** How many bytes the command and its descendant have appended so far. */
export function beats(dir: string): { readonly prepare: number; readonly child: number } {
  const size = (name: string) => (existsSync(join(dir, name)) ? statSync(join(dir, name)).size : 0);
  return { prepare: size("prepare.beat"), child: size("child.beat") };
}
