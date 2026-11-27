import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { insideRoot } from "./tree-wire.js";

/*
 * Spec 026 D13.1 (row 026-35): `remote.setup`, the project's script that
 * prepares each remote machine. The host runs it in its tree's root, as the
 * remote login user, after the tree arrives and before the install, bounded
 * to `SETUP_MS`. A mark per machine, under the remote cache, names the
 * SHA-256 of each script content that ran there and ended with exit code 0:
 * an equal mark is ready, an absent one runs the script, so an edit sets the
 * machine up again. Marks are one file per content, so two projects or two
 * worktrees on one machine with different scripts do not run each other's
 * again. A failure leaves no mark; its exit code and the end of its output
 * come back in the answer, and the daemon refuses the remote with them.
 *
 * The script is never part of a result key: the daemon passes it to the
 * connect only, never to a policy or an environment the keys read.
 */

/** How long the script may run (D13.1: 15 minutes). */
export const SETUP_MS = 900_000;

/** What the answer keeps of the script's output: its end. */
const OUTPUT_TAIL = 8_000;

/** `setup`'s answer: whether the script ran, and how it ended. */
export interface SetupAnswer {
  /** `false`: a mark for this content was there; the script did not run. */
  readonly ran: boolean;
  /** The SHA-256 of the script's content, hex; `null` when it could not be read. */
  readonly sha256: string | null;
  /** Present when it failed: `exit code 3`, `signal SIGTERM`, `no such file`, `timed out after 900 s`. */
  readonly failed?: string;
  /** The end of its output, stdout and stderr in order; empty when it did not run. */
  readonly output: string;
}

/** One script to run on a host's tree. */
export interface SetupPlace {
  /** The tree's root on the remote: the script's directory of work. */
  readonly root: string;
  /** The script, repository-relative. */
  readonly path: string;
  /** The machine's directory of marks: `<remote cache>/squeal/setup`. */
  readonly marks: string;
  readonly env: NodeJS.ProcessEnv;
  /** Takes each piece of output as it comes. */
  readonly output?: (text: string) => void;
  readonly timeoutMs?: number;
  /** Runs `work` while this host holds the lock file at its path. */
  readonly locked: <T>(lock: string, work: () => Promise<T>) => Promise<T>;
}

/** Runs `place.path` unless its content's mark is there; marks it after exit code 0. */
export async function runSetup(place: SetupPlace): Promise<SetupAnswer> {
  if (!insideRoot(place.path)) {
    return { ran: false, sha256: null, failed: "a path that leaves the tree", output: "" };
  }
  const script = join(place.root, place.path);
  let bytes: Buffer;
  try {
    bytes = await readFile(script);
  } catch {
    return { ran: false, sha256: null, failed: "no such file in the tree", output: "" };
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const mark = join(place.marks, sha256);
  if (existsSync(mark)) return { ran: false, sha256, output: "" };
  await mkdir(place.marks, { recursive: true });
  return place.locked(`${mark}.lock`, async () => {
    // Another host on the machine ran it while this one waited.
    if (existsSync(mark)) return { ran: false, sha256, output: "" };
    const ended = await runScript(script, place);
    if (ended.failed === undefined) {
      const part = `${mark}.${process.pid}.part`;
      await writeFile(part, `${place.path}\n`);
      await rename(part, mark);
    }
    const failed = ended.failed === undefined ? {} : { failed: ended.failed };
    return { ran: true, sha256, output: ended.output, ...failed };
  });
}

function runScript(
  script: string,
  place: SetupPlace,
): Promise<{ readonly output: string; readonly failed?: string }> {
  const timeoutMs = place.timeoutMs ?? SETUP_MS;
  return new Promise((resolve) => {
    const child = spawn(script, [], {
      cwd: place.root,
      env: place.env,
      stdio: ["ignore", "pipe", "pipe"],
      // Its own process group: past the bound, its children (an `apt-get`, a `sleep`) end with it.
      detached: true,
    });
    let tail = "";
    let timedOut = false;
    const take = (chunk: Buffer) => {
      const text = chunk.toString("utf8");
      place.output?.(text);
      tail = (tail + text).slice(-OUTPUT_TAIL);
    };
    child.stdout.on("data", take);
    child.stderr.on("data", take);
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        if (child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
      } catch {
        child.kill("SIGKILL");
      }
    }, timeoutMs);
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ output: tail, failed: `could not start: ${error.message}` });
    });
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (timedOut) resolve({ output: tail, failed: `timed out after ${timeoutMs / 1000} s` });
      else if (code === 0) resolve({ output: tail });
      else {
        const how = signal === null ? `exit code ${code}` : `signal ${signal}`;
        resolve({ output: tail, failed: how });
      }
    });
  });
}

/** The last `count` non-empty lines of `output`, joined by ` | `, for one status line. */
export function lastLines(output: string, count = 5): string {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "");
  return lines.slice(-count).join(" | ");
}

/** D13.1's refusal text: `remote.setup .squeal/setup.sh failed on box (exit code 3): <last lines>`. */
export function setupRefusal(path: string, destination: string, answer: SetupAnswer): string {
  const end = lastLines(answer.output);
  return `remote.setup ${path} failed on ${destination} (${answer.failed})${end === "" ? "" : `: ${end}`}`;
}
