import { join } from "node:path";
import { coreEnvironmentInputs, installedDependenciesFingerprint } from "../../keys/environment.js";
import type { AbsolutePath } from "../../types/common.js";
import type { TestFileRef } from "../../types/keys.js";
import {
  type InvalidatedPath,
  isBesideLane,
  isSlowLane,
  type RunnerAdapter,
  type RunOptions,
  type RunReport,
} from "../../types/runner.js";
import { isGroupLane } from "../../types/scheduler.js";
import { runnerHostGone } from "../proxy.js";
import { ADMIT_EVERY_MS, admitRun, cancelOf, notStarted } from "./admission.js";
import type { RemoteHost } from "./connect.js";
import { environmentDifferences } from "./environment.js";
import type { WhenLost } from "./settings.js";
import { readEntry } from "./tree.js";
import { insideRoot, type RemoteRunReply } from "./tree-wire.js";

/*
 * Spec 021 D11 to D13 (row 021-14): one runner's background runs on a
 * remote host, every other call here. A remote result is kept only when the
 * remote's tree is proven (the blob ids of the run's closure before the run,
 * and of the closure and observed inputs after it, equal this worktree's)
 * and its environment equals this worktree's. A tree difference sends the
 * files again and retries once. A lost or hung remote ends its run
 * incomplete; then the policy runs the lane's files here (`local`) or leaves
 * them not run (`not-run`), and the lane reconnects with backoff at a later
 * background run.
 *
 * Spec 021 D18, last bullet (row 021-21): a remote run counts against the
 * remote machine. Once the remote can take it, the run gives its local
 * permits back (`RunOptions.permits`) and waits for the remote machine's
 * admission, under that machine's ceiling and floor; a run that comes back
 * to run here waits for local permits again.
 */

export interface RemoteLaneOptions {
  readonly target: string;
  readonly whenLost: WhenLost;
  readonly root: AbsolutePath;
  readonly version: string;
  /** The runner here: every call but a background run's, and the closures the proof checks. */
  readonly local: RunnerAdapter;
  readonly connect: () => Promise<RemoteHost>;
  readonly allowlist: () => readonly string[];
  /** The lane's one status line, which replaces the last (D17). */
  readonly status: (text: string) => void;
  readonly log: (text: string) => void;
  readonly now?: () => number;
  /** Waits before each reconnect after a loss; the last repeats. */
  readonly backoffMs?: readonly number[];
  /** How often a run the remote machine refuses asks again. Default `ADMIT_EVERY_MS`. */
  readonly admitEveryMs?: number;
}

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

/** How many runs in a row may come after their grant went back before the remote counts as lost. */
const LATE_RUNS = 3;

/** A run of a background tier in the runner's own lane: one that may go remote (D12). */
export function goesRemote(options: RunOptions): boolean {
  const lane = options.lane ?? "";
  return (
    options.background === true && !isSlowLane(lane) && !isGroupLane(lane) && !isBesideLane(lane)
  );
}

type State =
  | { readonly kind: "connecting" }
  | { readonly kind: "ready"; readonly host: RemoteHost; proven: boolean }
  | {
      readonly kind: "down";
      readonly since: number;
      readonly retryAt: number;
      readonly refused: boolean;
    };

/** `local` with its background runs on the remote `connect` reaches. */
export function withRemoteLane(options: RemoteLaneOptions): RunnerAdapter {
  const { local, target } = options;
  const now = options.now ?? Date.now;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  let state: State = { kind: "down", since: now(), retryAt: 0, refused: false };
  let failures = 0;
  let notRun = 0;
  let why = "not connected yet";
  /** Paths invalidated since the last remote run, by path; sent before the next. */
  const pending = new Map<string, InvalidatedPath>();
  const queue = (paths: readonly InvalidatedPath[]) => {
    for (const path of paths) pending.set(path.path, path);
  };

  /** The remote cannot take runs: closed, and tried again after a backoff. */
  const down = (reason: string, refused: boolean, host?: RemoteHost) => {
    void host?.adapter.close().catch(() => {});
    const since = state.kind === "down" ? state.since : now();
    const wait = backoff[Math.min(failures, backoff.length - 1)] ?? 0;
    why = reason;
    state = { kind: "down", since, retryAt: now() + wait, refused };
    failures++;
    options.log(`remote ${target}: ${reason}`);
    tell();
  };
  const tell = () => {
    if (state.kind !== "down") return;
    const then = options.whenLost === "local" ? "running here" : `${notRun} files not run`;
    options.status(
      state.refused
        ? `remote ${target} refused: ${why}; ${then}`
        : `remote ${target} unreachable since ${new Date(state.since).toISOString()} (${why}); ${then}`,
    );
  };
  const connect = () => {
    state = { kind: "connecting" };
    pending.clear();
    options.connect().then(
      (host) => {
        state = { kind: "ready", host, proven: false };
        options.status(
          `remote ${target}: background runs of ${local.name} go there (Node ${host.node})`,
        );
      },
      (error: unknown) => down(error instanceof Error ? error.message : String(error), false),
    );
  };

  /** The host when it can take a run now; else `null`, and a reconnect when due. */
  const ready = (): RemoteHost | null => {
    if (state.kind === "down" && now() >= state.retryAt) connect();
    if (state.kind !== "ready") return null;
    const { host } = state;
    if (runnerHostGone(host.adapter)) {
      down("the host ended", false);
      return null;
    }
    return host;
  };

  const differences = async (host: RemoteHost): Promise<string[]> => {
    const allowlist = options.allowlist();
    const [remoteCore, remoteRunners, localRunners, installed] = await Promise.all([
      host.coreEnvironment(allowlist),
      host.adapter.environment(),
      local.environment(),
      installedDependenciesFingerprint(options.root, options.root),
    ]);
    const files = [...new Set([...remoteRunners, ...localRunners].flatMap((r) => r.files))];
    const [remoteBlobs, localBlobs] = await Promise.all([host.blobs(files), blobsHere(files)]);
    const core = coreEnvironmentInputs({
      squealVersion: options.version,
      installedDependencies: installed,
      allowlist,
    });
    return environmentDifferences(
      {
        core: { ...remoteCore, squealVersion: options.version },
        runners: remoteRunners,
        blob: (p) => remoteBlobs[p] ?? null,
      },
      { core, runners: localRunners, blob: (p) => localBlobs[p] ?? null },
    );
  };

  const blobsHere = async (paths: readonly string[]) => {
    const blobs: Record<string, string | null> = {};
    for (const path of paths) {
      blobs[path] = insideRoot(path)
        ? ((await readEntry(options.root, path))?.entry.blob ?? null)
        : null;
    }
    return blobs;
  };

  /**
   * The remote's run, proven over a current environment; `refused` after a
   * second tree refusal or a differing environment (then down), `lost` when
   * the host ended during it or its admission (then down), with its
   * incomplete report; `cancelled` during its admission.
   */
  const remoteRun = async (
    host: RemoteHost,
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<
    RunReport | "refused" | { readonly lost: RunReport } | { readonly cancelled: RunReport }
  > => {
    const closures = await Promise.all(testFiles.map((file) => local.closure(file)));
    const configs = (await local.environment()).flatMap((r) => r.files);
    const inputs = [...new Set([...closures.flatMap((c) => c.paths), ...configs])];
    for (let attempt = 0; attempt < 2; attempt++) {
      const queued = [...pending.values()];
      pending.clear();
      if (queued.length > 0) await host.adapter.invalidate(queued);
      // Review 0.1.442 B1: equal for this run, after the revision's files and any install
      // reached the host; the remote changes only through these messages, sent in turn.
      const unequal = await differences(host).catch((error: Error) => [error.message]);
      if (runnerHostGone(host.adapter)) {
        down("the host ended", false);
        return { lost: lostReport(testFiles) };
      }
      if (unequal.length > 0) {
        down(unequal.join("; "), true, host);
        return "refused";
      }
      const reply = await admittedRun(host, testFiles, run, inputs);
      if ("lost" in reply || "cancelled" in reply) return reply;
      if (runnerHostGone(host.adapter)) {
        down(reply.failure ?? "the host ended", false);
        return { lost: stripped(reply) };
      }
      const after =
        reply.refused === undefined ? await blobsHere(Object.keys(reply.proof ?? {})) : {};
      const differ =
        reply.refused ?? Object.keys(after).filter((path) => after[path] !== reply.proof?.[path]);
      if (differ.length === 0) {
        proven(host, inputs.length);
        return stripped(reply);
      }
      options.log(
        `remote ${target}: tree differs at ${differ.slice(0, 5).join(", ")}; sending again`,
      );
      queue(differ.map((path) => ({ path, kind: "change" as const })));
    }
    options.status(
      `remote ${target}: refused a run whose tree stayed different; ${options.whenLost === "local" ? "ran it here" : "not run"}`,
    );
    return "refused";
  };

  /**
   * D18 (row 021-21): the run admitted by the remote machine and sent there.
   * A run that came after its grant went back did not start (review 0.1.445
   * R1): the machine is asked again, up to `LATE_RUNS` times in a row, then
   * the remote counts as lost.
   */
  const admittedRun = async (
    host: RemoteHost,
    testFiles: readonly TestFileRef[],
    run: RunOptions,
    inputs: readonly string[],
  ): Promise<
    (RunReport & RemoteRunReply) | { readonly lost: RunReport } | { readonly cancelled: RunReport }
  > => {
    for (let late = 1; ; late++) {
      const grant = await admitRun((ask) => host.admit(ask), testFiles, run, {
        tierWidth: (file, grant) => local.tierWidth?.(file, grant) ?? grant,
        everyMs: options.admitEveryMs ?? ADMIT_EVERY_MS,
        log: (line) => options.log(`remote ${target}: ${line}`),
      }).catch((error: Error) => error);
      if (grant instanceof Error) {
        down(runnerHostGone(host.adapter) ? "the host ended" : grant.message, false, host);
        return { lost: lostReport(testFiles) };
      }
      if (grant === null) return { cancelled: notStarted() };
      const expected = await blobsHere(inputs);
      const { permits: _permits, ...sent } = run;
      const reply = (await host.adapter.run(testFiles, {
        ...sent,
        workers: grant,
        expected,
        admitted: true,
      } as RunOptions)) as RunReport & RemoteRunReply;
      if (reply.unadmitted !== true) return reply;
      if (late >= LATE_RUNS) {
        down(`its machine's grant went back before the run came, ${LATE_RUNS} times`, false, host);
        return { lost: lostReport(testFiles) };
      }
      options.log(
        `remote ${target}: its machine's grant went back before the run came; asking again`,
      );
    }
  };

  /** A lost run's report with nothing in it: every check of the tier `unknown`. */
  const lostReport = (testFiles: readonly TestFileRef[]): RunReport => ({
    end: "crashed",
    durationMs: 0,
    completedFiles: [],
    results: [],
    fileErrors: [],
    failure: `remote ${target} unreachable during the run of ${testFiles.length} files`,
  });

  /** Status names the first proven run of a connection; later ones go to the log alone. */
  const proven = (host: RemoteHost, paths: number) => {
    options.log(`remote ${target}: run proven over ${paths} paths`);
    if (state.kind !== "ready" || state.host !== host || state.proven) return;
    state.proven = true;
    options.status(
      `remote ${target}: background runs of ${local.name} go there; proven at ${new Date(now()).toISOString()} (blob ids equal before and after)`,
    );
  };

  /**
   * What the policy does with a background run the remote cannot take (D13):
   * `local` runs it here, in the tier the scheduler admitted under the local
   * budget, in a log directory no earlier attempt used. A run that gave its
   * local permits back waits for them again (D18, row 021-21).
   */
  const instead = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<RunReport> => {
    if (options.whenLost === "local") {
      const { permits, ...here } = run;
      const workers = permits === undefined ? run.workers : await permits.back(cancelOf(run));
      if (workers === null) return notStarted();
      return local.run(testFiles, {
        ...here,
        logDir: join(run.logDir, "here"),
        ...(workers === undefined ? {} : { workers }),
      });
    }
    notRun += testFiles.length;
    tell();
    return Promise.resolve({
      end: "crashed",
      durationMs: 0,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: `remote ${target} unreachable; not run here (whenLost "not-run")`,
    });
  };

  connect();
  return {
    ...local,
    name: local.name,
    adapterVersion: local.adapterVersion,
    invalidate(paths) {
      if (state.kind === "ready") queue(paths);
      return local.invalidate(paths);
    },
    affected: (paths) => local.affected(paths),
    closure: (file) => local.closure(file),
    enumerate: (file) => local.enumerate(file),
    testFiles: () => local.testFiles(),
    environment: () => local.environment(),
    async run(testFiles, run) {
      if (!goesRemote(run)) return local.run(testFiles, run);
      const host = ready();
      if (host === null) return instead(testFiles, run);
      const report = await remoteRun(host, testFiles, run);
      if (report === "refused") return instead(testFiles, run);
      if ("cancelled" in report) return report.cancelled;
      if ("lost" in report) {
        // Review 0.1.442 B4: nothing of the lost attempt is kept; under `local` its files run
        // here now, unless the tier was cancelled meanwhile; under `not-run` they end unknown.
        const cancelled = run.signal?.aborted === true || run.stop?.aborted === true;
        if (options.whenLost === "local" && !cancelled) return instead(testFiles, run);
        if (options.whenLost === "not-run") {
          notRun += testFiles.length;
          tell();
        }
        return report.lost;
      }
      failures = 0;
      notRun = 0;
      return report;
    },
    async close() {
      const host = state.kind === "ready" ? state.host : null;
      state = { kind: "down", since: now(), retryAt: Number.POSITIVE_INFINITY, refused: false };
      await Promise.allSettled([host?.adapter.close(), local.close()]);
    },
  };
}

/** A report without what only the lane reads. */
function stripped(report: RunReport & RemoteRunReply): RunReport {
  const { refused: _refused, proof: _proof, unadmitted: _unadmitted, ...rest } = report;
  return rest;
}
