import { type ChildProcess, spawn } from "node:child_process";

/*
 * Spec 026 D7.2 (row 026-10): a `command` provider's hook is an argument
 * list, never a shell string (as 020 D15): the first word is the program,
 * the rest its arguments. It runs in a process group of its own, so a
 * deadline kills what it started too.
 */

/** What `stderr` keeps of a hook. */
const KEEP = 4_000;

export interface HookRun {
  /** The hook's name for the error text: `acquire`, `wake`, `sleep` or `release`. */
  readonly name: string;
  readonly argv: readonly string[];
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

/** Runs the hook; resolves with its stdout when it exits 0, else rejects naming why with its stderr. */
export function runHook(run: HookRun): Promise<string> {
  const [program, ...args] = run.argv;
  const what = `the ${run.name} hook (${program ?? ""})`;
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(program ?? "", args, {
        env: run.env,
        stdio: ["ignore", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
    } catch (error) {
      reject(new Error(`${what} could not start: ${String(error)}`));
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      run.signal?.removeEventListener("abort", onAbort);
      if (error === null) resolve(stdout);
      else reject(error);
    };
    const killGroup = () => {
      try {
        if (child.pid !== undefined && process.platform !== "win32") {
          process.kill(-child.pid, "SIGKILL");
        } else child.kill("SIGKILL");
      } catch {
        // Gone already.
      }
    };
    const fail = (why: string) => {
      killGroup();
      finish(new Error(`${what} ${why}${context(stderr)}`));
    };
    const onAbort = () => fail("was aborted");
    const timer = setTimeout(
      () => fail(`did not finish within ${run.timeoutMs} ms`),
      run.timeoutMs,
    );
    run.signal?.addEventListener("abort", onAbort, { once: true });
    child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.setEncoding("utf8").on("data", (chunk: string) => {
      stderr = (stderr + chunk).slice(-KEEP);
    });
    child.on("error", (error) => finish(new Error(`${what} could not start: ${error.message}`)));
    child.on("close", (code, signal) => {
      if (code === 0) finish(null);
      else {
        const how = code === null ? `was killed by ${String(signal)}` : `exited with code ${code}`;
        finish(new Error(`${what} ${how}${context(stderr)}`));
      }
    });
  });
}

/** `: <stderr's last line>`, or nothing. */
function context(stderr: string): string {
  const last = stderr.trim().split("\n").at(-1) ?? "";
  return last === "" ? "" : `: ${last}`;
}
