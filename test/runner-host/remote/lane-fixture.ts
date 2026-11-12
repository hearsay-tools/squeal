import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as sleep } from "node:timers/promises";
import { afterAll, onTestFinished } from "vitest";
import type { HostedAdapter } from "../../../src/core/runner-host/host.js";
import type { HostDeadlines } from "../../../src/core/runner-host/proxy.js";
import type { HostAdmission } from "../../../src/core/runner-host/remote/admission.js";
import {
  type RemoteHost,
  RemoteRefusal,
  remoteHostOver,
} from "../../../src/core/runner-host/remote/connect.js";
import { withRemoteLane } from "../../../src/core/runner-host/remote/lane.js";
import type { WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import type {
  RunnerAdapter,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../../../src/core/types/runner.js";
import { inProcessHost, POLICY, REPORT } from "../fake-channel.js";

/*
 * Spec 021 D11 to D13 (row 021-14): a remote lane over a host served in this
 * process through a real proxy and tree host, with a fake adapter on each
 * side. Shared by `lane.test.ts` and `lane-repair.test.ts`.
 */

const scratch = mkdtempSync(join(tmpdir(), "squeal-remote-lane-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

export const REF = { project: "", path: "test/a.test.ts" };
export const ENV: RunnerEnvironment = {
  project: "",
  runnerName: "vitest",
  runnerVersion: "5.0.3",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: ["vitest.config.ts"],
};

export interface Setup {
  readonly whenLost?: WhenLost;
  readonly remoteEnv?: RunnerEnvironment;
  /** The remote adapter's run; `hang` stops the host's output, `kill` ends the host. */
  readonly remoteRun?: (
    root: string,
    hang: () => void,
    options: RunOptions,
    kill: () => void,
  ) => Promise<RunReport>;
  readonly deadlines?: Partial<HostDeadlines>;
  /** The env the remote's install runs with, such as a fake `npm` on its `PATH`. */
  readonly installEnv?: NodeJS.ProcessEnv;
  /** Files of the local tree beside the default ones. */
  readonly files?: Readonly<Record<string, string>>;
  /** The remote machine's admission (spec 021 D18, row 021-21); absent, it admits every run. */
  readonly admission?: HostAdmission;
  /** How often a refused run asks the remote again. */
  readonly admitEveryMs?: number;
  /** Prepares the local root before the lane connects, such as an install there. */
  readonly before?: (root: string) => void;
  /** Spec 021 D19.2: the lane's `needsRepository` globs. */
  readonly needsRepository?: readonly string[];
  /** Spec 021 D19.1: each connect is refused with this text, as for a missing command. */
  readonly refusal?: string;
}

let n = 0;
/** A lane over a host served in this process, connected; `remote.env` is what the host reports. */
export async function setup({
  whenLost = "local",
  remoteEnv = ENV,
  remoteRun,
  deadlines,
  installEnv,
  files = {},
  admission,
  admitEveryMs,
  before,
  needsRepository,
  refusal,
}: Setup = {}) {
  const dir = join(scratch, `s${++n}`);
  const root = join(dir, "local");
  const remoteRoot = join(dir, "remote", "root");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "test"), { recursive: true });
  mkdirSync(remoteRoot, { recursive: true });
  writeFileSync(join(root, "src/a.ts"), "export const a = 1;\n");
  writeFileSync(join(root, "test/a.test.ts"), "import '../src/a';\n");
  writeFileSync(join(root, "vitest.config.ts"), "export default {};\n");
  for (const [path, text] of Object.entries(files)) writeFileSync(join(root, path), text);
  before?.(root);
  execFileSync("git", ["init", "-q", root]);
  const remote = { env: remoteEnv };

  const remoteRuns: string[] = [];
  const localRuns: RunOptions[] = [];
  /** The files of each run here, joined as `remoteRuns`. */
  const localFiles: string[] = [];
  let paused = false;
  const fake = (env: () => RunnerEnvironment, run: HostedAdapter["run"]): HostedAdapter => ({
    name: "vitest",
    adapterVersion: "1",
    invalidate: async () => ({ recreatedProjects: [] }),
    affected: async () => ({ direct: [REF], transitive: [] }),
    closure: async (testFile) => ({ testFile, paths: ["src/a.ts", "test/a.test.ts"] }),
    enumerate: async () => [],
    testFiles: async () => [REF],
    environment: async () => [env()],
    run,
    close: async () => {},
  });
  const connects: number[] = [];
  const connect = async (): Promise<RemoteHost> => {
    connects.push(Date.now());
    if (refusal !== undefined) throw new RemoteRefusal(refusal);
    const host = inProcessHost(
      async () =>
        fake(
          () => remote.env,
          async (files, options) => {
            remoteRuns.push(files.map((f) => f.path).join(","));
            return remoteRun === undefined
              ? { ...REPORT, completedFiles: [...files] }
              : remoteRun(
                  remoteRoot,
                  () => {
                    paused = true;
                  },
                  options,
                  () => host.channel.kill(),
                );
          },
        ),
      "0.0.0-test",
      {
        tree: createTreeHost(remoteRoot, () => {}, installEnv),
        ...(admission === undefined ? {} : { admission }),
      },
    );
    // A paused remote: nothing more reaches the daemon.
    const output = new PassThrough();
    output.setEncoding("utf8");
    host.channel.output.on("data", (chunk: string) => {
      if (!paused) output.write(chunk);
    });
    onTestFinished(() => host.channel.kill());
    return remoteHostOver({ ...host.channel, output }, "v-test", {
      target: { destination: "box" },
      version: "0.0.0-test",
      root,
      runner: "vitest",
      options: { childEnv: {} },
      policy: () => POLICY,
      ...(deadlines === undefined ? {} : { deadlines }),
    });
  };
  const local: RunnerAdapter = fake(
    () => ENV,
    async (files, options) => {
      localRuns.push(options);
      localFiles.push(files.map((f) => f.path).join(","));
      return { ...REPORT, completedFiles: [...files] };
    },
  );
  const statuses: string[] = [];
  const logs: string[] = [];
  const repository: string[] = [];
  let clock = 1_000_000;
  const lane = withRemoteLane({
    target: "box",
    whenLost,
    root,
    version: "0.0.0-test",
    local,
    connect,
    allowlist: () => [],
    status: (text) => statuses.push(text),
    log: (text) => logs.push(text),
    ...(needsRepository === undefined ? {} : { needsRepository: () => needsRepository }),
    repository: (text) => repository.push(text),
    now: () => clock,
    backoffMs: [60_000],
    ...(admitEveryMs === undefined ? {} : { admitEveryMs }),
  });
  onTestFinished(() => lane.close());
  // Row 021-24: the lane compares at connect, so a remote may be refused before any run.
  await until(() => statuses.some((s) => / go there| refused| unreachable/.test(s)));
  return {
    lane,
    remote,
    root,
    remoteRoot,
    remoteRuns,
    localRuns,
    localFiles,
    statuses,
    logs,
    repository,
    connects,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

export async function until(done: () => boolean, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  while (!done()) {
    if (Date.now() > end) throw new Error("until: not met");
    await sleep(10);
  }
}

export const options = (extra: Partial<RunOptions> = {}): RunOptions => ({
  runId: `r${++n}`,
  logDir: join(scratch, `logs${n}`),
  timeoutMs: 60_000,
  ...extra,
});
export const background = (extra: Partial<RunOptions> = {}) =>
  options({ background: true, workers: 2, lane: "vitest", ...extra });
