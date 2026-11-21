import { execFileSync, spawn } from "node:child_process";
import { hashFile } from "../hash/blob.js";
import { type Clock, type EndHashes, type EndWork, hashEnd } from "./endpoints-hash.js";

/*
 * Row 018-67 (review 0.1.585 S1, spec 018 D30, D20.2): each end of `ci
 * record`'s endpoint hashing runs in a child process, `squeal ci
 * endpoints-child`, started by `CliIo.relaunch`. Past the limit (row
 * 018-61) `ci record` kills the child and lets go of it. A read the
 * operating system never ends (a hung network file system) then holds the
 * child, not `ci record`'s process: that one exits with the command's code
 * once the command and the parts are done. A worker thread would not do:
 * `terminate()` waits for the thread's read to end.
 *
 * The parent sends the end's work as one IPC message; the child sends
 * `begin` once it knows the paths, `hashed` counts as paths finish, and
 * then its result or its error.
 *
 * Row 018-73 (review 0.1.587 S1): the child starts `git`, whose own timer
 * dies with the child. So the child leads a process group of its own, and
 * ending it ends the group: past the limit the parent kills the group, and
 * a child whose parent is gone kills its own. Without groups (Windows),
 * `taskkill /T` ends the child and every process it started.
 */

/** The hidden `squeal ci` subcommand of the child. */
export const ENDPOINTS_CHILD = "endpoints-child";

type FromChild =
  | { readonly begin: number }
  | { readonly hashed: number }
  | { readonly result: EndHashes | string }
  | { readonly error: string };

/** The last characters of the child's stderr a failure names. */
const STDERR_TAIL = 2000;

/**
 * `work` in a child started by `relaunch`, its progress told to `clock`.
 * When `stop` aborts, the child is killed and let go: neither it nor its
 * pipes hold this process, and the promise never settles.
 */
export function hashInChild(
  relaunch: readonly string[],
  work: EndWork,
  clock: Clock,
  stop: AbortSignal,
): Promise<EndHashes | string> {
  const [command = process.execPath, ...flags] = relaunch;
  const child = spawn(command, [...flags, "ci", ENDPOINTS_CHILD], {
    cwd: work.root,
    detached: !WINDOWS,
    stdio: ["ignore", "ignore", "pipe", "ipc"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString("utf8")).slice(-STDERR_TAIL);
  });
  const release = () => {
    if (child.connected) child.disconnect();
    child.stderr?.destroy();
    child.unref();
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    const settle = (end: () => void) => {
      if (settled || stop.aborted) return;
      settled = true;
      stop.removeEventListener("abort", abandon);
      release();
      end();
    };
    const abandon = () => {
      endTree(child.pid);
      child.kill("SIGKILL");
      release();
    };
    stop.addEventListener("abort", abandon, { once: true });
    child.on("message", (message: FromChild) => {
      if ("begin" in message) clock.begin(message.begin);
      else if ("hashed" in message) clock.hashed(message.hashed);
      else if ("result" in message) settle(() => resolve(message.result));
      else settle(() => reject(new Error(message.error)));
    });
    child.once("error", (error) => settle(() => reject(error)));
    child.once("exit", (code, signal) => {
      // A child that ended without a result may leave its git behind.
      if (!settled && !WINDOWS) endTree(child.pid);
      const how = signal === null ? `with exit code ${code}` : `on ${signal}`;
      const why = stderr.trim() === "" ? "" : `: ${stderr.trim()}`;
      settle(() => reject(new Error(`its process ended ${how} without a result${why}`)));
    });
    try {
      child.send(work);
    } catch (error) {
      settle(() => reject(error));
    }
  });
}

/**
 * In the child: the one end its parent sends, hashed from the disk, its
 * progress and its result sent back. 2 when this process has no parent to
 * talk to.
 */
export function serveEnd(): Promise<number> {
  const send = process.send?.bind(process);
  if (send === undefined) return Promise.resolve(2);
  // The parent is gone: nothing waits for the hashes, nor for the git they started.
  const gone = () => {
    endTree(process.pid);
    process.exit(0);
  };
  process.once("disconnect", gone);
  let pending = 0;
  const flush = () => {
    if (pending === 0) return;
    send({ hashed: pending } satisfies FromChild);
    pending = 0;
  };
  const clock: Clock = {
    over: false,
    begin: (total) => send({ begin: total } satisfies FromChild),
    hashed: (count) => {
      // One message per turn of the event loop, however many paths ended in it.
      if (pending === 0) setImmediate(flush);
      pending += count;
    },
  };
  return new Promise((resolve) => {
    process.once("message", (work: EndWork) => {
      const done = (message: FromChild) => {
        flush();
        process.off("disconnect", gone);
        send(message, () => {
          process.disconnect();
          resolve(0);
        });
      };
      hashEnd(work, hashFile, clock).then(
        (result) => done({ result }),
        (error: unknown) => done({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
  });
}

const WINDOWS = process.platform === "win32";

/**
 * Ends the hashing child `pid` and every process it started, at once: its
 * process group with SIGKILL, or `taskkill /T /F` on Windows. A process
 * stuck in a read the operating system never ends dies when the read does;
 * nothing here waits for that.
 */
function endTree(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    if (WINDOWS) {
      execFileSync("taskkill", ["/PID", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
        timeout: 5000,
      });
    } else process.kill(-pid, "SIGKILL");
  } catch {
    // The group or the tree has ended, or this process leads no group.
  }
}
