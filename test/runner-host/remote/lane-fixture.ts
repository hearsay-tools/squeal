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
import type { RemoteTier, WhenLost } from "../../../src/core/runner-host/remote/settings.js";
import { createTreeHost } from "../../../src/core/runner-host/remote/tree-host.js";
import type { RemoteRecord } from "../../../src/core/runner-host/remote/tree-wire.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";
import type {
  RunnerAdapter,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../../../src/core/types/runner.js";
import { NO_TRAITS } from "../../../src/core/types/runner-traits.js";
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
  /** The local adapter's run; absent, each file completes with no result. */
  readonly localRun?: (files: readonly TestFileRef[]) => Promise<RunReport>;
  /** Review 0.1.616 S2: false connects at the first background run, and setup does not wait. */
  readonly eager?: boolean;
  /** Spec 026 D8.1: the tiers that go remote; absent, `background`. */
  readonly lanes?: readonly RemoteTier[];
  /** Spec 026 D8.1: runs that go remote wait for the connect. */
  readonly awaitConnect?: boolean;
  /** Spec 026 D8.1: the runner of the runs here, made from the local one. */
  readonly here?: (local: RunnerAdapter) => RunnerAdapter;
  /** Spec 026 D8.3: where the lane plans. */
  readonly planning?: "local" | "remote";
  /** Spec 026 D8.4: whether the machine's tree is a Git repository. */
  readonly hasGitRepository?: () => boolean;
  /** Row 026-24: each file's closure, here and on the remote; absent, `src/a.ts` and `test/a.test.ts`. */
  readonly closure?: (file: TestFileRef) => readonly string[];
  /** Row 026-30: the lane's Git lease, the daemon's exit and its recovery call. */
  readonly gitLease?: () => Promise<() => void>;
  readonly exitSignal?: AbortSignal;
  readonly onRecovered?: () => void;
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
  localRun,
  eager,
  lanes,
  awaitConnect,
  here,
  planning,
  hasGitRepository,
  closure,
  gitLease,
  exitSignal,
  onRecovered,
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
  /** Spec 026 D8.3: each call on the local adapter but `run` and `close`, and on the remote one. */
  const localCalls: string[] = [];
  const remoteCalls: string[] = [];
  const fake = (
    env: () => RunnerEnvironment,
    run: HostedAdapter["run"],
    calls: string[],
  ): HostedAdapter => ({
    name: "vitest",
    adapterVersion: "1",
    traits: NO_TRAITS,
    invalidate: async (paths) => {
      calls.push(`invalidate ${paths.map((p) => p.path).join(",")}`);
      return { recreatedProjects: [] };
    },
    affected: async (paths) => {
      calls.push(`affected ${paths.join(",")}`);
      return { direct: [REF], transitive: [] };
    },
    closure: async (testFile) => {
      calls.push(`closure ${testFile.path}`);
      return { testFile, paths: [...(closure?.(testFile) ?? ["src/a.ts", "test/a.test.ts"])] };
    },
    enumerate: async (testFile) => {
      calls.push(`enumerate ${testFile.path}`);
      return [];
    },
    testFiles: async () => {
      calls.push("testFiles");
      return [REF];
    },
    environment: async () => {
      calls.push("environment");
      return [env()];
    },
    run,
    close: async () => {},
  });
  const connects: number[] = [];
  /** Each connect's start and each host's close, in turn (review 0.1.616 B7). */
  const events: string[] = [];
  const connect = async (): Promise<RemoteHost> => {
    connects.push(Date.now());
    events.push("connect");
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
          remoteCalls,
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
    const remoteHost = await remoteHostOver({ ...host.channel, output }, "v-test", {
      target: { destination: "box" },
      version: "0.0.0-test",
      root,
      runner: "vitest",
      options: { childEnv: {} },
      policy: () => POLICY,
      ...(deadlines === undefined ? {} : { deadlines }),
    });
    const close = remoteHost.adapter.close.bind(remoteHost.adapter);
    remoteHost.adapter.close = async () => {
      events.push("close");
      await close();
    };
    return remoteHost;
  };
  let localCloses = 0;
  const local: RunnerAdapter = {
    ...fake(
      () => ENV,
      async (files, options) => {
        localRuns.push(options);
        localFiles.push(files.map((f) => f.path).join(","));
        return localRun === undefined ? { ...REPORT, completedFiles: [...files] } : localRun(files);
      },
      localCalls,
    ),
    close: async () => {
      localCloses++;
    },
  };
  const activity: number[] = [];
  const statuses: string[] = [];
  const logs: string[] = [];
  const repository: string[] = [];
  /** Spec 026 D9: the records each proven run handed on (row 026-24). */
  const coverage: { runId: string; records: RemoteRecord[] }[] = [];
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
    remoteCoverage: (runId, records) => coverage.push({ runId, records: [...records] }),
    now: () => clock,
    backoffMs: [60_000],
    ...(admitEveryMs === undefined ? {} : { admitEveryMs }),
    ...(eager === undefined ? {} : { eager }),
    ...(lanes === undefined ? {} : { lanes }),
    ...(awaitConnect === undefined ? {} : { awaitConnect }),
    ...(here === undefined ? {} : { here: here(local) }),
    ...(planning === undefined ? {} : { planning }),
    ...(hasGitRepository === undefined ? {} : { hasGitRepository }),
    ...(gitLease === undefined ? {} : { gitLease }),
    ...(exitSignal === undefined ? {} : { exitSignal }),
    ...(onRecovered === undefined ? {} : { onRecovered }),
    activity: () => activity.push(clock),
  });
  onTestFinished(() => lane.close());
  // Row 021-24: the lane compares at connect, so a remote may be refused before any run.
  if (eager !== false) {
    await until(() => statuses.some((s) => / go there| refused| unreachable/.test(s)));
  }
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
    coverage,
    connects,
    events,
    activity,
    localCloses: () => localCloses,
    localCalls,
    remoteCalls,
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
