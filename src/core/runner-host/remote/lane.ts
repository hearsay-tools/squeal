import { join } from "node:path";
import { merge } from "../../daemon/composite-runner.js";
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
import { type RemoteHost, RemoteRefusal } from "./connect.js";
import { blobsAt, compareRemote } from "./lane-compare.js";
import { deferredTo, repositoryRoute, withoutFiles } from "./lane-repository.js";
import type { WhenLost } from "./settings.js";
import type { RemoteRunReply } from "./tree-wire.js";

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
 *
 * Spec 021 D19 (row 021-23): a background tier's files that read the
 * repository (`remote.needsRepository`) run here first, under the tier's
 * local permits, and the rest go remote. A remote run's file that failed
 * as not a Git repository keeps no result and runs here again. A report
 * holds one setup failure (review 0.1.457 B3): a part after one whose run
 * failed to start does not run, and its files join that failure's.
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
  /** Spec 021 D19.2: test-file globs that always run here. Absent: none. */
  readonly needsRepository?: () => readonly string[];
  /** The line that names the files a remote failed as not a Git repository. Absent: `status`. */
  readonly repository?: (text: string) => void;
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
  const route = repositoryRoute(
    options.needsRepository ?? (() => []),
    options.repository ?? options.status,
  );

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
    options
      .connect()
      .then(compareFirst)
      .catch((error: unknown) => {
        // Spec 021 D19.1: a command the tests need, missing there, is a refusal, not a loss.
        if (state.kind === "connecting") {
          down(
            error instanceof Error ? error.message : String(error),
            error instanceof RemoteRefusal,
          );
        }
      });
  };

  /**
   * Row 021-24 (`boat-trial.md` D3): a connected remote takes no run before
   * its environment is compared; a refusal is named now, not at its first
   * run. Each run compares again (review 0.1.442 B1).
   */
  const compareFirst = async (host: RemoteHost) => {
    const closed = () => void host.adapter.close().catch(() => {});
    if (state.kind !== "connecting") return closed();
    options.status(`remote ${target}: connected (Node ${host.node}), not yet compared`);
    const unequal = await sendPending(host)
      .then(() => compared(host))
      .catch((error: Error) => [error.message]);
    // Closed meanwhile: this host is no one's.
    if (state.kind !== "connecting") closed();
    else if (runnerHostGone(host.adapter)) down("the host ended", false);
    else if (unequal.length > 0) down(unequal.join("; "), true, host);
    else {
      state = { kind: "ready", host, proven: false };
      options.status(
        `remote ${target}: background runs of ${local.name} go there (Node ${host.node}; environment equal)`,
      );
    }
  };

  /** The paths invalidated since the last message to the host, sent now. */
  const sendPending = async (host: RemoteHost) => {
    const queued = [...pending.values()];
    pending.clear();
    if (queued.length > 0) await host.adapter.invalidate(queued);
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

  const compared = (host: RemoteHost) => compareRemote(host, options);
  const blobsHere = (paths: readonly string[]) => blobsAt(options.root, paths);

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
      await sendPending(host);
      // Review 0.1.442 B1: equal for this run, after the revision's files and any install
      // reached the host; the remote changes only through these messages, sent in turn.
      const unequal = await compared(host);
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
        tierWidth: (file, grant) => local.traits.tierWidth(file, grant),
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
   * `testFiles` run here, in the tier the scheduler admitted under the local
   * budget, in the log directory `dir` under the run's, which no other part
   * of the run uses. A run that gave its local permits back waits for them
   * again (D18, row 021-21); one that did not keeps them.
   */
  const runHere = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
    dir: string,
  ): Promise<RunReport> => {
    const { permits, ...here } = run;
    const workers = permits === undefined ? run.workers : await permits.back(cancelOf(run));
    if (workers === null) return notStarted();
    return local.run(testFiles, {
      ...here,
      logDir: join(run.logDir, dir),
      ...(workers === undefined ? {} : { workers }),
    });
  };

  /**
   * What the policy does with a background run the remote cannot take (D13):
   * `local` runs it here; `not-run` leaves it not run.
   */
  const instead = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<RunReport> => {
    if (options.whenLost === "local") return runHere(testFiles, run, "here");
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

  /** A background tier of files that may go remote: there when the remote takes it, else as D13 says. */
  const remoteTier = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<RunReport> => {
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
    // D19.2's guard: a file that failed there as not a Git repository keeps no result; it runs here.
    const failed = route.guard(report);
    if (failed.length === 0) return report;
    options.log(
      `remote ${target}: ${failed.map((f) => f.path).join(", ")} failed there as not a Git repository; running here`,
    );
    const kept = withoutFiles(report, failed);
    // B3: the remote's own setup failure stands; the failed files run here in a later tier.
    if (kept.startupFailure !== undefined) return deferredTo(kept, failed);
    return merge([
      { adapter: { name: `remote ${target}` }, report: kept },
      { adapter: { name: "here" }, report: await runHere(failed, run, "here") },
    ]);
  };

  connect();
  return {
    ...local,
    name: local.name,
    adapterVersion: local.adapterVersion,
    invalidate(paths) {
      // While connecting too: the tree it sent may predate them.
      if (state.kind !== "down") queue(paths);
      return local.invalidate(paths);
    },
    affected: (paths) => local.affected(paths),
    closure: (file) => local.closure(file),
    enumerate: (file) => local.enumerate(file),
    testFiles: () => local.testFiles(),
    environment: () => local.environment(),
    async run(testFiles, run) {
      if (!goesRemote(run)) return local.run(testFiles, run);
      const { here, there } = route.split(testFiles);
      if (there.length === 0) return local.run(testFiles, run);
      if (here.length === 0) return remoteTier(there, run);
      // D19.2: the repository's readers first, while the tier holds its local permits.
      const own = await runHere(here, run, "repository");
      // A `squeal stop` starts no further part: its files stay queued (D10, task 001-367).
      if (run.stop?.aborted === true) return own;
      // B3: its setup failure stands; the rest of the tier runs in a later one.
      if (own.startupFailure !== undefined) return deferredTo(own, there);
      return merge([
        { adapter: { name: "here" }, report: own },
        { adapter: { name: `remote ${target}` }, report: await remoteTier(there, run) },
      ]);
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
