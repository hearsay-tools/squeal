import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { childrenOf } from "../../src/core/daemon/terminate.js";
import type { RunnerHostLaunch } from "../../src/core/runner-host/channel.js";
import type { ProcessHost } from "../../src/core/runner-host/process-host.js";
import type { RunReport } from "../../src/core/types/runner.js";

/*
 * Row 021-12: what the node:test and pytest host tests share. Their hosts
 * run from the sources, `node --import tsx src/cli/index.ts runner-host`, as
 * a daemon from the sources starts them (review 0.1.434 B6); a build of
 * `src` would cost each file a `tsc` run for the same code.
 */

const REPO = resolve(import.meta.dirname, "../..");
const TSX = pathToFileURL(createRequire(import.meta.url).resolve("tsx")).href;

/** The launch of a host from the sources. */
export const SOURCE_LAUNCH: RunnerHostLaunch = {
  execPath: process.execPath,
  execArgv: ["--import", TSX],
  cli: join(REPO, "src/cli/index.ts"),
};

/** A host from the sources, with `env` as its environment when given. */
export function sourceHost(version: string, env?: NodeJS.ProcessEnv): ProcessHost {
  return { launch: SOURCE_LAUNCH, version, ...(env === undefined ? {} : { env }) };
}

/** A report without what differs between two runs of the same files: durations, run ids. */
export function steady(report: RunReport): unknown {
  return {
    ...report,
    durationMs: 0,
    results: report.results.map((r) => ({ ...r, durationMs: 0 })),
    fileDurations: report.fileDurations?.map((d) => ({ ...d, durationMs: 0 })),
  };
}

/** The runner hosts of `runner` this process started: their pids. Linux only. */
export function hostsOf(runner: string): number[] {
  return childrenOf(process.pid).filter((pid) => {
    try {
      const args = readFileSync(`/proc/${pid}/cmdline`, "latin1").split("\0");
      const at = args.indexOf("--runner");
      return args.includes("runner-host") && at >= 0 && args[at + 1] === runner;
    } catch {
      return false;
    }
  });
}
