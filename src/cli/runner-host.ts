import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { Readable } from "node:stream";
import { squealVersion } from "../core/daemon/version.js";
import { serveRunnerHost } from "../core/runner-host/host.js";
import { HOST_RUNNERS, type HostRunner } from "../core/runner-host/protocol.js";
import { buildAdapter } from "../core/runner-host/runners.js";
import { hostWorkers } from "../core/runner-host/workers.js";
import type { AbsolutePath } from "../core/types/common.js";
import type { CliIo } from "./main.js";

const USAGE = `usage: squeal runner-host <root> --runner <${HOST_RUNNERS.join("|")}>\n`;

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
 * the store. Its working directory is the root; its own stdout and every
 * library's go to stderr. It exits once the daemon closes it or its input
 * ends. Exit code 0, or 2 on a usage error or a root it cannot read.
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
    root = realpathSync(resolve(io.cwd ?? process.cwd(), parsed.root));
  } catch (error) {
    io.stderr(`squeal runner-host: cannot read the root ${parsed.root}: ${String(error)}\n`);
    return 2;
  }
  const owned = options.write === undefined;
  if (owned) process.chdir(root);
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
  });
  // The adapter closed or its bound passed; a handle a dependency left open must not keep the host.
  if (owned) setTimeout(() => process.exit(0), 500).unref();
  return 0;
}

function parse(args: readonly string[]): { root: string; runner: HostRunner } | null {
  const [root, flag, runner, ...rest] = args;
  if (root === undefined || root.startsWith("-") || flag !== "--runner" || rest.length > 0) {
    return null;
  }
  const known = HOST_RUNNERS.find((name) => name === runner);
  return known === undefined ? null : { root, runner: known };
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
