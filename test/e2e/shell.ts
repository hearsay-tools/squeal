import { spawn } from "node:child_process";
import type { BundleRun } from "../harness/bundle-helpers.js";
import { testUserDirs } from "../harness/user-dirs.js";

/**
 * `<shell> -c <command>` in `cwd` with HOME and `env` only, stdin piped,
 * timed: a hook command string run the way its harness runs it (Codex under
 * `bash`, Antigravity under `sh`).
 */
export function runShell(
  shell: "bash" | "sh",
  command: string,
  stdin: string,
  cwd: string,
  env: Readonly<Record<string, string>>,
): Promise<BundleRun> {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const child = spawn(shell, ["-c", command], {
      cwd,
      // Review 0.1.658 B5: never the user's remote config or machine registry.
      env: { HOME: process.env.HOME ?? "", ...testUserDirs(), ...env },
    });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("error", reject);
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(out).toString("utf8"),
        stderr: Buffer.concat(err).toString("utf8"),
        code,
        ms: performance.now() - started,
      }),
    );
    // A hook the fast path ends never reads its stdin.
    child.stdin.on("error", () => {});
    child.stdin.end(stdin);
  });
}
