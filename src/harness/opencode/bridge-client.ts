import { spawn } from "node:child_process";

/*
 * Spec 008 D4: the plugin's side of the bridge. It runs in OpenCode's Bun, so
 * it imports only `node:child_process` here (the bundle's import list is
 * asserted by a build test).
 */

/** How long after the bridge's exit its last output may take to arrive. */
export const EXIT_DRAIN_MS = 50;

/** How to start the bridge: a Node of Squeal's minimum, and the bridge entry it runs. */
export interface BridgeCommand {
  readonly node: string;
  readonly entry: string;
}

export interface CallOptions {
  /** Aborting it kills the bridge's group and settles the call as silence (D5's cancel). */
  readonly signal?: AbortSignal;
  /**
   * Holds nothing that keeps the host alive while the call runs, not only
   * once it settles: the idle waiter (D5) must not keep `opencode run` open.
   */
  readonly background?: boolean;
}

/** Unreferences a pipe where the runtime lets it (Node's sockets; Bun's may not). */
function unrefPipe(pipe: unknown): void {
  const unref = (pipe as { unref?: () => void } | null)?.unref;
  if (typeof unref === "function") unref.call(pipe);
}

/**
 * Runs one bridge process: `node <entry>` in its own process group with cwd
 * `cwd`, `event` written to its stdin as JSON, and its stdout read as one JSON
 * answer. Resolves the answer, or `null` when the bridge misses `deadlineMs`,
 * exits non-zero, writes no or invalid JSON, or cannot be spawned. Never
 * rejects. At a missed deadline the whole group is killed: OpenCode awaits
 * plugin hooks with no timeout, so this deadline is the hook's only bound.
 * The bridge's own exit settles the call, not its stdout's end, which a
 * descendant holding the pipe would delay; the group is killed then too.
 *
 * Nothing it holds keeps the host alive past the call: the deadline timer is
 * cleared when the call settles, and the child and its pipes are unreferenced
 * once it has.
 */
export function callBridge<A>(
  command: BridgeCommand,
  event: object,
  cwd: string,
  deadlineMs: number,
  options: CallOptions = {},
): Promise<A | null> {
  return new Promise((resolve) => {
    if (options.signal?.aborted) return resolve(null);
    let settled = false;
    const out: Buffer[] = [];
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(command.node, ["--disable-warning=ExperimentalWarning", command.entry], {
        cwd,
        detached: true,
        stdio: ["pipe", "pipe", "ignore"],
      });
    } catch {
      resolve(null);
      return;
    }
    let code: number | null = null;
    const killGroup = () => {
      if (child.pid === undefined) return;
      try {
        process.kill(-child.pid, "SIGKILL");
      } catch {
        // Already gone.
      }
    };
    const settle = (answer: A | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(drain);
      options.signal?.removeEventListener("abort", cancel);
      if (code === null) killGroup();
      child.stdout?.destroy();
      child.stdin?.destroy();
      child.unref();
      resolve(answer);
    };
    const answered = () =>
      settle(code === 0 ? parseAnswer<A>(Buffer.concat(out).toString("utf8")) : null);
    const timer = setTimeout(() => settle(null), deadlineMs);
    let drain: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => settle(null);
    options.signal?.addEventListener("abort", cancel);
    if (options.background) {
      timer.unref?.();
      child.unref();
      unrefPipe(child.stdout);
      unrefPipe(child.stdin);
    }
    child.on("error", () => settle(null));
    child.stdout?.on("data", (chunk: Buffer) => out.push(chunk));
    child.stdout?.on("error", () => settle(null));
    // Its end once every writer closed it; a descendant that inherited it may never close it.
    child.stdout?.on("end", () => {
      if (code !== null) answered();
    });
    child.stdin?.on("error", () => {
      // EPIPE when the bridge exits before reading: its exit settles the call.
    });
    // The leader's exit settles the call (review 008-15): its group is killed at once, while
    // the pgid is still its own, and what it wrote is read to the pipe's end, which that kill
    // brings, or within `EXIT_DRAIN_MS`.
    child.on("exit", (exitCode) => {
      code = exitCode ?? -1;
      killGroup();
      if (code !== 0 || child.stdout === null || child.stdout.readableEnded) return answered();
      drain = setTimeout(answered, EXIT_DRAIN_MS);
    });
    child.stdin?.end(JSON.stringify(event));
  });
}

/** The bridge prints `{"answer": ...}`; anything else is no answer. */
function parseAnswer<A>(stdout: string): A | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    if (typeof parsed !== "object" || parsed === null || !("answer" in parsed)) return null;
    return (parsed as { answer: A }).answer;
  } catch {
    return null;
  }
}
