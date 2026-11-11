import { mkdirSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { squealVersion } from "../core/daemon/version.js";
import { serveRunnerHost } from "../core/runner-host/host.js";
import { HOST_RUNNERS, type HostRunner } from "../core/runner-host/protocol.js";
import { createTreeHost } from "../core/runner-host/remote/tree-host.js";
import { buildAdapter } from "../core/runner-host/runners.js";
import { hostWorkers } from "../core/runner-host/workers.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";

const USAGE = `usage: squeal runner-host <root> --runner <${HOST_RUNNERS.join("|")}> [--tree]\n`;

/** What tests give in place of the process's own stdio. */
export interface RunnerHostCommandOptions {
  /** The daemon's messages; default the process's stdin. */
  readonly input?: Readable;
  /** Writes one protocol line; default the process's stdout, which no one else then writes. */
  readonly write?: (line: string) => void;
}

/**
 * `squeal runner-host <root> --runner <name>` (spec 021 D6, row 021-11): the
 * project's own adapter for one runner over one root, in a process of its
 * own, answering the daemon's requests on stdin and stdout. It never opens
 * the store. Its working directory is the root while a call is in flight,
 * else the one it started in; its own stdout and every library's go to
 * stderr. It exits once the daemon closes it or its input ends. Exit code
 * 0, or 2 on a usage error or a root it cannot read.
 *
 * `--tree` (spec 021 D10, row 021-13): the host runs on a remote and owns
 * its root, a copy the daemon's messages write; it makes the root when
 * missing and keeps its records in the directory around it.
 */
export async function runnerHostCommand(
  args: readonly string[],
  io: CliIo,
  options: RunnerHostCommandOptions = {},
): Promise<number> {
  const parsed = parse(args);
  if (parsed === null) {
    io.stderr(USAGE);
    return 2;
  }
  let root: AbsolutePath;
  try {
    const given = resolve(io.cwd ?? process.cwd(), parsed.root);
    if (parsed.tree) mkdirSync(given, { recursive: true });
    root = realpathSync(given);
  } catch (error) {
    io.stderr(`squeal runner-host: cannot read the root ${parsed.root}: ${String(error)}\n`);
    return 2;
  }
  const owned = options.write === undefined;
  const write = options.write ?? takeStdout();
  await serveRunnerHost({
    input: options.input ?? process.stdin,
    write,
    build: (start, hooks) => {
      if (start.runner !== parsed.runner) {
        throw new Error(`runner host for ${parsed.runner} asked to start ${start.runner}`);
      }
      return buildAdapter(root, start, hooks);
    },
    version: squealVersion(),
    around: hostWorkers(),
    ...(parsed.tree ? { tree: createTreeHost(root, (text) => process.stderr.write(text)) } : {}),
    ...(owned ? { within: inRootWhileAnswering(root, process.cwd()) } : {}),
  });
  // The adapter closed or its bound passed; a handle a dependency left open must not keep the host.
  if (owned) setTimeout(() => process.exit(0), 500).unref();
  return 0;
}

/**
 * Runs calls with `root` as the working directory, and returns to `away`
 * once none is in flight, as the daemon did for its in-process runner
 * (`inRootWhileRunning`): Vite names paths from the working directory
 * (`runner-split.md` Q2), and between calls nothing of Squeal's is held
 * inside the root, so a harness can remove the worktree (spec 001 D10,
 * lessons defect 13). A directory that is gone is left to the call to fail
 * on, and to the daemon to end the host.
 */
function inRootWhileAnswering(
  root: AbsolutePath,
  away: string,
): <T>(call: () => Promise<T>) => Promise<T> {
  let inFlight = 0;
  const move = (dir: string) => {
    try {
      process.chdir(dir);
    } catch {
      // Left where it was.
    }
  };
  return async (call) => {
    if (inFlight++ === 0) move(root);
    try {
      return await call();
    } finally {
      if (--inFlight === 0) move(away);
    }
  };
}

function parse(
  args: readonly string[],
): { root: string; runner: HostRunner; tree: boolean } | null {
  const [root, flag, runner, ...rest] = args;
  const tree = rest.length === 1 && rest[0] === "--tree";
  if (root === undefined || root.startsWith("-") || flag !== "--runner") return null;
  if (rest.length > 0 && !tree) return null;
  const known = HOST_RUNNERS.find((name) => name === runner);
  return known === undefined ? null : { root, runner: known, tree };
}

/**
 * The process's stdout for protocol lines alone: what anything else writes
 * to it, Vitest's reporters and a test's `console.log` among them, goes to
 * stderr (`runner-split.md` Q3).
 */
function takeStdout(): (line: string) => void {
  const own = process.stdout.write.bind(process.stdout);
  process.stdout.write = process.stderr.write.bind(process.stderr) as typeof process.stdout.write;
  return (line) => {
    own(line);
  };
}
