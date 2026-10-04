import { type ChildProcess, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const register = fileURLToPath(new URL("./register-ts.mjs", import.meta.url));
const worker = fileURLToPath(new URL("./worker.ts", import.meta.url));

export interface Finished {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Worker {
  readonly child: ChildProcess;
  readonly done: Promise<Finished>;
  /** Resolves once stdout contains `text`. */
  waitFor(text: string): Promise<void>;
}

/** Starts `worker.ts` in a plain Node process, the way hooks and daemons run. */
export function spawnWorker(args: readonly string[]): Worker {
  const child = spawn(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--import", register, worker, ...args],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  const waiters: { text: string; resolve: () => void }[] = [];
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk;
    for (const waiter of waiters.filter((w) => stdout.includes(w.text))) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  });
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk;
  });
  const done = new Promise<Finished>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });
  return {
    child,
    done,
    waitFor: (text) =>
      new Promise<void>((resolve, reject) => {
        if (stdout.includes(text)) return resolve();
        waiters.push({ text, resolve });
        done.then((f) => reject(new Error(`exited before "${text}": ${f.stderr}`)), reject);
      }),
  };
}

/** Parses the last line a worker prints as JSON, failing with its stderr otherwise. */
export function report<T>(finished: Finished): T {
  if (finished.code !== 0) {
    throw new Error(`worker exited ${finished.code ?? finished.signal}: ${finished.stderr}`);
  }
  const lines = finished.stdout.trim().split("\n");
  return JSON.parse(lines[lines.length - 1] ?? "") as T;
}
