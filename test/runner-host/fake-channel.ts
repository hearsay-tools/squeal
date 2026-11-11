import { PassThrough } from "node:stream";
import type { HostChannel } from "../../src/core/runner-host/channel.js";
import {
  type HostedAdapter,
  type ServeOptions,
  serveRunnerHost,
} from "../../src/core/runner-host/host.js";
import type { HostPolicy } from "../../src/core/runner-host/protocol.js";
import type { RunnerAdapter, RunReport } from "../../src/core/types/runner.js";

/** A host served in this process over stream pairs, and the daemon's channel to it. */
export interface InProcessHost {
  readonly channel: HostChannel;
  /** Settles once `serveRunnerHost` returned. */
  readonly served: Promise<void>;
  /** Whether `kill` ended it. */
  killed(): boolean;
  /** Lines the daemon wrote, parsed. */
  readonly sent: unknown[];
}

/** Serves `build`'s adapter in this process; `kill` ends it as a killed process would. */
export function inProcessHost(
  build: ServeOptions["build"],
  version = "0.0.0-test",
  extra: Partial<ServeOptions> = {},
): InProcessHost {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  const sent: unknown[] = [];
  let killed = false;
  let end: (how: string) => void = () => {};
  const ended = new Promise<string>((resolve) => {
    end = resolve;
  });
  const served = serveRunnerHost({
    input,
    write: (line) => {
      if (!killed) output.write(line);
    },
    build,
    version,
    ...extra,
  });
  void served.then(() => end("code 0"));
  return {
    sent,
    served,
    killed: () => killed,
    channel: {
      pid: null,
      write: (line) => {
        sent.push(JSON.parse(line.slice(line.indexOf("{"))));
        if (!killed) input.write(line);
      },
      output,
      ended,
      endInput: () => input.end(),
      kill: () => {
        if (killed) return;
        killed = true;
        end("signal SIGKILL");
      },
      stderrTail: () => "",
    },
  };
}

export const POLICY: HostPolicy = {
  observe: false,
  exclude: [],
  excludeProjects: [],
  coverage: false,
  coverageChildren: false,
};

export const REPORT: RunReport = {
  end: "completed",
  durationMs: 1,
  completedFiles: [],
  results: [],
  fileErrors: [],
  failure: null,
};

/** A fake adapter: every member answers at once unless replaced. */
export function fakeAdapter(over: Partial<HostedAdapter> = {}): HostedAdapter {
  const base: RunnerAdapter = {
    name: "vitest",
    adapterVersion: "fake-1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: [testFile.path] }),
    enumerate: async () => [],
    testFiles: async () => [],
    environment: async () => [],
    run: async () => REPORT,
    close: async () => {},
  };
  return { ...base, ...over };
}
