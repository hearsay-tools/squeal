import { join } from "node:path";
import { merge } from "../../daemon/composite-runner.js";
import { coreEnvironmentInputs } from "../../keys/environment.js";
import type { AbsolutePath } from "../../types/common.js";
import type { CoreEnvironmentInputs, TestFileRef } from "../../types/keys.js";
import type {
  InvalidatedPath,
  InvalidateResult,
  RunnerAdapter,
  RunOptions,
  RunReport,
} from "../../types/runner.js";
import { runnerHostGone } from "../proxy.js";
import { ADMIT_EVERY_MS, admitRun, cancelledFirst, cancelOf, notStarted } from "./admission.js";
import { createBlobCache, createInstalledFingerprintCache } from "./blob-cache.js";
import { type RemoteHost, RemoteRefusal } from "./connect.js";
import { recordsWithout } from "./coverage.js";
import { compareRemoteEnvironment } from "./lane-compare.js";
import { type Planning, remotePlanning } from "./lane-planning.js";
import { deferredTo, repositoryRoute, withoutFiles } from "./lane-repository.js";
import { DEFAULT_TIERS, goesRemote, tiersText } from "./lane-tiers.js";
import {
  attachRemoteCore,
  type EnvironmentMode,
  machineText,
  remoteKeyStatusLine,
  tagReportCore,
} from "./remote-key.js";
import type { RemoteTier, WhenLost } from "./settings.js";
import type { LaneReport } from "./summary.js";
import type { RemoteRecord, RemoteRunReply } from "./tree-wire.js";

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
 *
 * Review 0.1.616 B7 (spec 026 D12.4): `sleep` closes the idle channel
 * first, then asks the machine to sleep; a remote run in flight refuses it.
 * The next background run connects again, which wakes the machine. S2: a
 * lane that is not `eager` connects at its first background run.
 *
 * Spec 026 D8.1 (row 026-11): the lane sends the runs of each tier in
 * `lanes` (`lane-tiers.ts`), not only background ones. A lane made for one
 * pass of a slow or group lane plans with the runner's own instance
 * (`local`), runs here in its own (`here`), and waits for its connect
 * (`awaitConnect`) instead of running its first tier here. `busy` says
 * whether a sleep would be refused, so a machine shared by several lanes
 * sleeps only when none is busy; `activity` marks each remote run, connect
 * and invalidation for the machine's idle sleep (D7.3).
 *
 * Review 0.1.617 B1: `close` aborts the connect's signal and waits for the
 * connect to end; a host it reached meanwhile is closed before `close` ends.
 *
 * Spec 026 D8.3 (row 026-12): under `planning: "remote"` the lane plans on
 * its remote host (`lane-planning.ts`), warms the host's first `affected`
 * before it reports ready, proves a run over the host's own closures, sends
 * each invalidation there at once, and asks the runner here nothing until a
 * planning call or a run falls back to it. D8.4: on a machine whose tree is
 * a Git repository, `needsRepository` files go there too; D19.2's guard stays.
 * Review 0.1.619 B3: before a tier that may go remote is split, the lane
 * asks `refreshRepository`, so `hasGitRepository` answers for the
 * worktree's Git state now; the call is busy for a sleep, like a planning call.
 * Review 0.1.619-r2 N1: each remote run holds `gitLease` while it is there.
 *
 * Spec 026 D9 (row 026-13): the coverage records a remote run's reply
 * carries go to `remoteCoverage` only once its blob proof holds, less
 * those of files D19.2's guard sends here; a refused, lost, cancelled or
 * unadmitted run's are dropped with it.
 *
 * Row 026-23: each admission attempt holds its grant under its own token,
 * which its run claims, so concurrent tiers never take each other's. A host
 * goes down once: sibling runs that end on it later count no second failure
 * and keep the first reason, and a host the lane moved on from takes no
 * newer one down. A run the host's end cut short is lost, never completed.
 * Under `whenLost: "not-run"` a run waits for a connect or wake in flight,
 * as under `awaitConnect`, and ends not started when cancelled meanwhile.
 */

export interface RemoteLaneOptions {
  readonly target: string;
  readonly whenLost: WhenLost;
  readonly root: AbsolutePath;
  readonly version: string;
  /** The runner here: its planning (closures, environment) and every run that stays here. */
  readonly local: RunnerAdapter;
  /**
   * Spec 026 D8.1: the runner of the runs that stay here, whose `invalidate`
   * and `close` the lane's are, such as a slow lane's own instance; its
   * planning stays `local`'s. Absent: `local`.
   */
  readonly here?: RunnerAdapter;
  /** Spec 026 D8.1: the tiers whose runs go remote (`lane-tiers.ts`). Absent: `background`. */
  readonly lanes?: readonly RemoteTier[];
  /** A run that goes remote while the lane connects waits for the connect. Absent: it runs here. */
  readonly awaitConnect?: boolean;
  /** Spec 026 D7.3: called at each remote run's start and end, each connect and each queued invalidation. */
  readonly activity?: () => void;
  /** Spec 026 D8: called when the remote is lost (not refused): its machine may have slept by itself. */
  readonly lost?: () => void;
  /** Reaches the remote host; `signal` aborts when the lane closes, and a queued connect then starts none. */
  readonly connect: (signal: AbortSignal) => Promise<RemoteHost>;
  readonly allowlist: () => readonly string[];
  /** Spec 026 D8.3: where the lane plans; absent, `local`. */
  readonly planning?: Planning;
  /** Spec 026 D10: `remote-key` keys results to the remote's machine; absent, `match-local`. */
  readonly environmentMode?: EnvironmentMode;
  /** Spec 026 D8.4: whether the machine's tree is a Git repository; then `needsRepository` files go there. */
  readonly hasGitRepository?: () => boolean;
  /**
   * Review 0.1.619 B3: brings the machine's `.git` to the worktree's Git
   * state when it moved, before `hasGitRepository` is read for a tier;
   * `signal` aborts when the lane closes. Absent: nothing to refresh.
   */
  readonly refreshRepository?: (signal: AbortSignal) => Promise<void>;
  /**
   * Review 0.1.619-r2 N1: a lease on the machine's `.git` for the time a
   * run is there, which no refresh of another lane breaks; the returned
   * call ends it. Absent: none.
   */
  readonly gitLease?: () => Promise<() => void>;
  /** Spec 026 D9: a proven run's coverage records, of the files whose results it keeps. Absent: dropped. */
  readonly remoteCoverage?: (runId: string, records: readonly RemoteRecord[]) => void;
  /** The daemon's exit began: no planning call falls back to the runner here. Absent: never. */
  readonly ending?: () => boolean;
  /** Spec 021 D19.2: test-file globs that always run here. Absent: none. */
  readonly needsRepository?: () => readonly string[];
  /** The line that names the files a remote failed as not a Git repository. Absent: `status`. */
  readonly repository?: (text: string) => void;
  /** The lane's one status line, which replaces the last (D17); `report` changed with it. */
  readonly status: (text: string) => void;
  readonly log: (text: string) => void;
  readonly now?: () => number;
  /** Waits before each reconnect after a loss; the last repeats. */
  readonly backoffMs?: readonly number[];
  /** How often a run the remote machine refuses asks again. Default `ADMIT_EVERY_MS`. */
  readonly admitEveryMs?: number;
  /** Connect now (default), or at the first background run (S2: a deferred runner). */
  readonly eager?: boolean;
}

/** What `RemoteLaneRunner.sleep` did: slept, or not because a run or a connect is on the remote. */
export type LaneSleep = "slept" | { readonly busy: string };

/** The lane's runner, which can also put its remote to sleep (B7). */
export interface RemoteLaneRunner extends RunnerAdapter {
  /** Why `sleep` would be refused now: a remote run or a connect in flight; `null`: it would not. */
  busy(): string | null;
  /**
   * Closes the remote's channel, then calls `machineSleep`; refused while a
   * remote run or a connect is in flight. Until `machineSleep` ends, no run
   * goes remote; after it, the next background run connects again.
   */
  sleep(machineSleep: () => Promise<void>): Promise<LaneSleep>;
  /** Row 026-20 (spec 026 D12.1): where the lane stands now, for status's `Remote:` line. */
  report(): LaneReport;
}

const BACKOFF_MS = [30_000, 60_000, 120_000, 300_000, 600_000];

const NOTHING: InvalidateResult = { recreatedProjects: [] };

/** No lease to hold: a machine that keeps no `.git` current. */
const NO_LEASE: Promise<() => void> = Promise.resolve(() => {});

/** How many runs in a row may come after their grant went back before the remote counts as lost. */
const LATE_RUNS = 3;

/** `ready`'s answer when the run's cancel aborted while it waited for a connect. */
const CANCELLED = Symbol("cancelled");

type State =
  | { readonly kind: "connecting" }
  /** B7: closed for sleep (`going`: the machine is being asked); the next run connects. */
  | { readonly kind: "asleep"; readonly going: boolean }
  | { readonly kind: "ready"; readonly host: RemoteHost; proven: boolean }
  | {
      readonly kind: "down";
      readonly since: number;
      readonly retryAt: number;
      readonly refused: boolean;
    };

/** `local` with its background runs on the remote `connect` reaches. */
export function withRemoteLane(options: RemoteLaneOptions): RemoteLaneRunner {
  const { local, target } = options;
  const here = options.here ?? local;
  const tiers = options.lanes ?? DEFAULT_TIERS;
  const tiersName = tiersText(tiers);
  const activity = options.activity ?? (() => {});
  const now = options.now ?? Date.now;
  const backoff = options.backoffMs ?? BACKOFF_MS;
  const remotePlans = options.planning === "remote";
  const remoteKey = options.environmentMode === "remote-key";
  /** Spec 026 D10: the remote's verified core while ready or asleep under `remote-key`. */
  let remoteCore: CoreEnvironmentInputs | null = null;
  const localCore = (): CoreEnvironmentInputs =>
    coreEnvironmentInputs({
      squealVersion: options.version,
      installedDependencies: "",
      allowlist: [],
    });
  let state: State = { kind: "down", since: now(), retryAt: 0, refused: false };
  let failures = 0;
  let notRun = 0;
  /** Remote runs in flight: a sleep waits for none (B7). */
  let remoteRuns = 0;
  /** D8.3: planning calls and invalidations on the remote in flight: a sleep waits for none. */
  let planningCalls = 0;
  /** Review 0.1.619 B3: refreshes of the machine's `.git` in flight: a sleep waits for none. */
  let refreshes = 0;
  /** D8.3: the runner here was asked (a run here, or planning here): it gets each invalidation. */
  let opened = !remotePlans;
  let closed = false;
  /** Ends when a sleep in flight asked its machine; a planning call waits for it. */
  let sleepEnd: Promise<void> = Promise.resolve();
  let why = "not connected yet";
  /** D12.1: when the current connection's first run was proven; `null` before. */
  let provenAt: number | null = null;
  /** D12.1: whether the lane ever started a connect: before, it is `not connected`. */
  let tried = false;
  /** The connect in flight, which a run of an `awaitConnect` lane waits for. */
  let connecting: Promise<void> = Promise.resolve();
  /** Aborted at `close`: a connect not yet started starts no host. */
  const closing = new AbortController();
  /** The host a connect reached and still compares: `close` closes it at once. */
  let comparing: RemoteHost | null = null;
  /**
   * Row 026-23: the host the lane's state stands on, from its compare until
   * it goes down; a `down` for any other host only closes it.
   */
  let standing: RemoteHost | null = null;
  /** Row 026-23: makes each admission attempt's token unique (`AdmitAsk.token`). */
  let attempts = 0;
  /** Paths invalidated since the last remote run, by path; sent before the next. */
  const pending = new Map<string, InvalidatedPath>();
  const queue = (paths: readonly InvalidatedPath[]) => {
    for (const path of paths) pending.set(path.path, path);
  };
  /** D9: a proven remote report's coverage records, until its tier keeps them. */
  const coverageOf = new WeakMap<RunReport, readonly RemoteRecord[]>();
  const route = repositoryRoute(
    options.needsRepository ?? (() => []),
    options.repository ?? options.status,
    options.hasGitRepository ?? (() => false),
  );

  /**
   * The remote cannot take runs: closed, and tried again after a backoff.
   * Row 026-23: a `host` already down, or one the lane moved on from, is
   * only closed: no second failure, no new reason, no newer host down.
   */
  const down = (reason: string, refused: boolean, host?: RemoteHost) => {
    void host?.adapter.close().catch(() => {});
    if (host !== undefined && host !== standing) return;
    standing = null;
    remoteCore = null;
    const since = state.kind === "down" ? state.since : now();
    const wait = backoff[Math.min(failures, backoff.length - 1)] ?? 0;
    why = reason;
    state = { kind: "down", since, retryAt: now() + wait, refused };
    failures++;
    if (!refused) options.lost?.();
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
    standing = null;
    tried = true;
    provenAt = null;
    pending.clear();
    activity();
    connecting = options
      .connect(closing.signal)
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
    const closed = () => host.adapter.close().catch(() => {});
    if (state.kind !== "connecting") return closed();
    options.status(`remote ${target}: connected (Node ${host.node}), not yet compared`);
    comparing = host;
    standing = host;
    const unequal = await sendPending(host)
      .then(() => compared(host))
      .then(async (found) => {
        // D8.3: the remote's first `affected` is slow (6 to 8 s); it is paid before ready.
        if (found.differences.length === 0 && remotePlans) await warm(host);
        return found.differences;
      })
      .catch((error: Error) => [error.message]);
    // Unless `close` took it meanwhile, and closed it.
    const ours = comparing === host;
    comparing = null;
    // Closed meanwhile: this host is no one's.
    if (state.kind !== "connecting") await (ours ? closed() : undefined);
    else if (runnerHostGone(host.adapter)) down("the host ended", false, host);
    else if (unequal.length > 0) down(unequal.join("; "), true, host);
    else {
      state = { kind: "ready", host, proven: false };
      options.status(
        remoteKey && remoteCore !== null
          ? remoteKeyStatusLine(target, remoteCore)
          : `remote ${target}: ${tiersName} runs ${remotePlans ? "and planning " : ""}of ${local.name} go there (Node ${host.node}; environment equal)`,
      );
    }
  };

  /** D8.3: the host's first `affected`; a failure is logged, and the calls that follow say it. */
  const warm = (host: RemoteHost) =>
    host.adapter
      .affected([])
      .then(() => {})
      .catch((error: Error) =>
        options.log(`remote ${target}: its first affected failed: ${error.message}`),
      );

  /** The paths invalidated since the last message to the host, sent now; the host's answer. */
  const sendPending = async (host: RemoteHost): Promise<InvalidateResult> => {
    const queued = [...pending.values()];
    pending.clear();
    return queued.length > 0 ? host.adapter.invalidate(queued) : NOTHING;
  };

  /**
   * The host when it can take a run now; else `null`, and a reconnect when
   * due. A lane that `awaitConnect`s, and a planning call (`wait`), answers
   * once the connect ends, and waits for a sleep in flight first. Row
   * 026-23: `CANCELLED` when `cancel` aborts during either wait.
   */
  const ready = async (
    wait = options.awaitConnect === true,
    cancel?: AbortSignal,
  ): Promise<RemoteHost | null | typeof CANCELLED> => {
    if (wait && state.kind === "asleep" && state.going) {
      if (await cancelledFirst(sleepEnd, cancel)) return CANCELLED;
    }
    return reach(wait, cancel);
  };
  const reach = async (
    wait: boolean,
    cancel?: AbortSignal,
  ): Promise<RemoteHost | null | typeof CANCELLED> => {
    if (state.kind === "down" && now() >= state.retryAt) connect();
    if (state.kind === "asleep" && !state.going) connect();
    if (state.kind === "connecting" && wait) {
      if (await cancelledFirst(connecting, cancel)) return CANCELLED;
    }
    const current = state as State;
    if (current.kind !== "ready") return null;
    const { host } = current;
    if (runnerHostGone(host.adapter)) {
      down("the host ended", false, host);
      return null;
    }
    return host;
  };
  /** A planning call's host: it waits, uncancelled. */
  const planningHost = async (): Promise<RemoteHost | null> => {
    const host = await ready(true);
    return host === CANCELLED ? null : host;
  };

  const blobCache = createBlobCache(options.root, now);
  const installedCache = createInstalledFingerprintCache(options.root, now);
  const compared = async (host: RemoteHost) => {
    const result = await compareRemoteEnvironment(host, {
      ...options,
      blobCache,
      installedCache,
    });
    if (remoteKey && result.differences.length === 0 && result.remoteCore !== null) {
      remoteCore = result.remoteCore;
    }
    return result;
  };
  const blobsHere = (paths: readonly string[]) => blobCache.blobs(paths);

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
    | RunReport
    | { readonly refused: string }
    | { readonly lost: RunReport }
    | { readonly cancelled: RunReport }
  > => {
    const inputs = await runInputs(host, testFiles).catch((error: Error) => error);
    if (inputs instanceof Error) {
      if (!runnerHostGone(host.adapter)) throw inputs;
      down("the host ended", false, host);
      return { lost: lostReport(testFiles) };
    }
    let stayed: readonly string[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      await sendPending(host);
      // Review 0.1.442 B1: equal for this run, after the revision's files and any install
      // reached the host; the remote changes only through these messages, sent in turn.
      const { differences: unequal, remoteCore: runCore } = await compared(host);
      if (runnerHostGone(host.adapter)) {
        down("the host ended", false, host);
        return { lost: lostReport(testFiles) };
      }
      if (unequal.length > 0) {
        down(unequal.join("; "), true, host);
        return { refused: unequal.join("; ") };
      }
      const end = await (options.gitLease?.() ?? NO_LEASE);
      const reply = await admittedRun(host, testFiles, run, inputs).finally(end);
      if ("lost" in reply || "cancelled" in reply) return reply;
      if (runnerHostGone(host.adapter)) return { lost: cutShort(host, reply, testFiles) };
      const after =
        reply.refused === undefined ? await blobsHere(Object.keys(reply.proof ?? {})) : {};
      const differ =
        reply.refused ?? Object.keys(after).filter((path) => after[path] !== reply.proof?.[path]);
      if (differ.length === 0) {
        proven(host, inputs.length);
        const raw = stripped(reply);
        const report = remoteKey && runCore !== null ? tagReportCore(raw, runCore) : raw;
        if (reply.coverage !== undefined) coverageOf.set(report, reply.coverage);
        return report;
      }
      stayed = differ;
      options.log(
        `remote ${target}: tree differs at ${differ.slice(0, 5).join(", ")}; sending again`,
      );
      queue(differ.map((path) => ({ path, kind: "change" as const })));
    }
    options.status(
      `remote ${target}: refused a run whose tree stayed different; ${options.whenLost === "local" ? "ran it here" : "not run"}`,
    );
    return { refused: `its tree stayed different at ${stayed.slice(0, 5).join(", ")}` };
  };

  /**
   * The paths a run's proof covers: its files' closures and the config files,
   * planned here, or under D8.3 by the host, after the queued paths reached it.
   */
  const runInputs = async (host: RemoteHost, testFiles: readonly TestFileRef[]) => {
    const planner = remotePlans ? host.adapter : local;
    if (remotePlans) await sendPending(host);
    const closures = await Promise.all(testFiles.map((file) => planner.closure(file)));
    const configs = (await planner.environment()).flatMap((r) => r.files);
    return [...new Set([...closures.flatMap((c) => c.paths), ...configs])];
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
      // Row 026-23: this attempt's own grant, which no concurrent tier's look drops.
      const token = `${run.runId}:${++attempts}`;
      const grant = await admitRun((ask) => host.admit(ask), testFiles, run, {
        token,
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
        admitToken: token,
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

  /**
   * The report of a run whose host ended under it, which goes down. Row
   * 026-23: one the host's end cut short stays lost, never `completed`;
   * only a report that names its end, such as a timeout, is kept.
   */
  const cutShort = (
    host: RemoteHost,
    reply: RunReport & RemoteRunReply,
    testFiles: readonly TestFileRef[],
  ): RunReport => {
    down(reply.failure ?? "the host ended", false, host);
    const named = reply.end !== "completed" && reply.failure != null;
    return named ? stripped(reply) : lostReport(testFiles);
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
    provenAt = now();
    const at = new Date(provenAt).toISOString();
    options.status(
      remoteKey && remoteCore !== null
        ? `${remoteKeyStatusLine(target, remoteCore)}; proven at ${at} (blob ids equal before and after)`
        : `remote ${target}: ${tiersName} runs of ${local.name} go there; proven at ${at} (blob ids equal before and after)`,
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
    const { permits, ...rest } = run;
    opened = true;
    const workers = permits === undefined ? run.workers : await permits.back(cancelOf(run));
    if (workers === null) return notStarted();
    const report = await here.run(testFiles, {
      ...rest,
      logDir: join(run.logDir, dir),
      ...(workers === undefined ? {} : { workers }),
    });
    return remoteKey ? tagReportCore(report, localCore()) : report;
  };

  /** A run that never goes remote: here, as the scheduler admitted it, the runner here now opened. */
  const runDirect = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<RunReport> => {
    opened = true;
    const report = await here.run(testFiles, run);
    return remoteKey ? tagReportCore(report, localCore()) : report;
  };

  /**
   * What the policy does with a background run the remote cannot take (D13):
   * `local` runs it here; `not-run` leaves it not run. Row 026-20 (lessons
   * D3): `refusal` is the reason a reachable remote refused it; absent, the
   * lane's own state says whether the remote refused or was not reached.
   */
  const instead = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
    refusal?: string,
  ): Promise<RunReport> => {
    if (options.whenLost === "local") return runHere(testFiles, run, "here");
    notRun += testFiles.length;
    tell();
    const reason = refusal ?? (state.kind === "down" && state.refused ? why : null);
    return Promise.resolve({
      end: "crashed",
      durationMs: 0,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure:
        reason === null
          ? `remote ${target} unreachable; not run here (whenLost "not-run")`
          : `remote ${target} refused (${reason}); not run here (whenLost "not-run")`,
    });
  };

  /** A background tier of files that may go remote: there when the remote takes it, else as D13 says. */
  const remoteTier = async (
    testFiles: readonly TestFileRef[],
    run: RunOptions,
  ): Promise<RunReport> => {
    // Counted from before the host is picked: a sleep finds the run busy, not its host closed.
    remoteRuns++;
    activity();
    // Row 026-23: under `not-run` a run waits for a connect or wake in flight, as under `awaitConnect`.
    const wait = options.awaitConnect === true || options.whenLost === "not-run";
    const report = await ready(wait, cancelOf(run))
      .then((host) =>
        host === CANCELLED
          ? { cancelled: notStarted() }
          : host === null
            ? null
            : remoteRun(host, testFiles, run),
      )
      .finally(() => {
        remoteRuns--;
        activity();
      });
    if (report === null) return instead(testFiles, run);
    if ("refused" in report) return instead(testFiles, run, report.refused);
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
    // D9: the proven run's records, of the files whose results stand.
    const records = recordsWithout(coverageOf.get(report) ?? [], failed);
    if (records.length > 0) options.remoteCoverage?.(run.runId, records);
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

  /** D12.1: the lane's state as status names it. */
  const report = (): LaneReport => {
    const machine = remoteKey && remoteCore !== null ? { machine: machineText(remoteCore) } : {};
    switch (state.kind) {
      case "connecting":
        return { state: "connecting" };
      case "asleep":
        return { state: "asleep" };
      case "ready":
        return { state: "ready", ...(provenAt === null ? {} : { provenAt }), ...machine };
      default:
        if (closed || !tried) return { state: "not connected" };
        return { state: state.refused ? "refused" : "unreachable", reason: why };
    }
  };

  const busy = (): string | null => {
    if (remoteRuns > 0) return `a run is on remote ${target}`;
    if (planningCalls > 0) return `a planning call is on remote ${target}`;
    if (refreshes > 0) return `remote ${target}'s Git state is being refreshed`;
    if (state.kind === "connecting") return `remote ${target} is connecting`;
    if (state.kind === "asleep" && state.going) return `remote ${target} is going to sleep`;
    return null;
  };

  /** D8.3: a call on the remote begins; busy, and active for the idle sleep, until it ends. */
  const begin = () => {
    planningCalls++;
    activity();
    return () => {
      planningCalls--;
      activity();
    };
  };
  const ending = () => closed || options.ending?.() === true;

  /** B3: the machine's `.git` at the worktree's Git state, or known not to be, before a split. */
  const refreshRepository = async () => {
    // Called during the exit too: what it reads here then still says whether the `.git` there is current.
    if (options.refreshRepository === undefined) return;
    refreshes++;
    activity();
    await options
      .refreshRepository(closing.signal)
      .catch((error: Error) =>
        options.log(`remote ${target}: its Git state not refreshed: ${error.message}`),
      )
      .finally(() => {
        refreshes--;
        activity();
      });
  };
  /** `host` ended during a call: down, unless the lane moved on from it meanwhile. */
  const ended = (host: RemoteHost) => {
    if (state.kind === "ready" && state.host === host) down("the host ended", false, host);
  };

  /**
   * D8.3: an invalidation sent to a ready host now, its answer with the one
   * here when the runner here was asked before; while connecting, queued.
   */
  const invalidateThere = async (paths: readonly InvalidatedPath[]) => {
    const host = state.kind === "ready" ? state.host : null;
    if (state.kind === "ready" || state.kind === "connecting") {
      queue(paths);
      activity();
    }
    const ours = () => (opened ? here.invalidate(paths) : Promise.resolve(NOTHING));
    if (host === null || runnerHostGone(host.adapter)) return ours();
    const end = begin();
    const there = await sendPending(host)
      .catch((error: Error) => {
        if (!runnerHostGone(host.adapter)) throw error;
        ended(host);
        return NOTHING;
      })
      .finally(end);
    const projects = new Set([...there.recreatedProjects, ...(await ours()).recreatedProjects]);
    return { recreatedProjects: [...projects].sort() };
  };

  const planning = remotePlans
    ? remotePlanning({
        target,
        whenLost: options.whenLost,
        local,
        host: planningHost,
        send: sendPending,
        lost: ended,
        begin,
        why: () =>
          state.kind !== "down"
            ? `not connected (${why})`
            : state.refused
              ? `refused: ${why}`
              : `unreachable since ${new Date(state.since).toISOString()} (${why})`,
        ending,
        opened: () => {
          opened = true;
        },
      })
    : null;

  if (options.eager !== false) connect();
  return {
    ...here,
    name: local.name,
    adapterVersion: local.adapterVersion,
    traits: local.traits,
    invalidate(paths) {
      const names = paths.map((p) => p.path);
      blobCache.evict(names);
      installedCache.onInvalidate(names);
      if (remotePlans) return invalidateThere(paths);
      // While connecting too: the tree it sent may predate them. A connect sends the whole tree.
      if (state.kind === "ready" || state.kind === "connecting") {
        queue(paths);
        activity();
      }
      return here.invalidate(paths);
    },
    affected: (paths) => local.affected(paths),
    closure: (file) => local.closure(file),
    enumerate: (file) => local.enumerate(file),
    testFiles: () => local.testFiles(),
    ...planning,
    async environment() {
      if (planning !== null) {
        const envs = await planning.environment();
        return remoteKey && state.kind === "ready" && remoteCore !== null
          ? attachRemoteCore(envs, remoteCore)
          : envs;
      }
      if (remoteKey && state.kind === "connecting") await ready(true);
      const envs = await local.environment();
      return remoteKey && remoteCore !== null ? attachRemoteCore(envs, remoteCore) : envs;
    },
    async run(testFiles, run) {
      // Review 0.1.619 B4: a run here opens the runner here, which gets each later invalidation.
      if (!goesRemote(run, tiers)) return runDirect(testFiles, run);
      await refreshRepository();
      const split = route.split(testFiles);
      const { there } = split;
      if (there.length === 0) return runDirect(testFiles, run);
      if (split.here.length === 0) return remoteTier(there, run);
      // D19.2: the repository's readers first, while the tier holds its local permits.
      const own = await runHere(split.here, run, "repository");
      // A `squeal stop` starts no further part: its files stay queued (D10, task 001-367).
      if (run.stop?.aborted === true) return own;
      // B3: its setup failure stands; the rest of the tier runs in a later one.
      if (own.startupFailure !== undefined) return deferredTo(own, there);
      return merge([
        { adapter: { name: "here" }, report: own },
        { adapter: { name: `remote ${target}` }, report: await remoteTier(there, run) },
      ]);
    },
    busy,
    report,
    async sleep(machineSleep) {
      const refused = busy();
      if (refused !== null) return { busy: refused };
      const host = state.kind === "ready" ? state.host : null;
      state = { kind: "asleep", going: true };
      standing = null;
      let asleep = () => {};
      sleepEnd = new Promise<void>((resolve) => {
        asleep = resolve;
      });
      try {
        await host?.adapter.close().catch(() => {});
        await machineSleep();
      } finally {
        if (state.kind === "asleep") state = { kind: "asleep", going: false };
        asleep();
      }
      failures = 0;
      options.status(`remote ${target}: asleep; the next ${tiersName} run wakes it`);
      return "slept";
    },
    async close() {
      const host = state.kind === "ready" ? state.host : comparing;
      comparing = null;
      standing = null;
      closed = true;
      state = { kind: "down", since: now(), retryAt: Number.POSITIVE_INFINITY, refused: false };
      closing.abort();
      // A connect in flight ends too; it closes any host it reaches later (`compareFirst`).
      await Promise.allSettled([connecting, host?.adapter.close(), here.close()]);
    },
  };
}

/** A report without what only the lane reads. */
function stripped(report: RunReport & RemoteRunReply): RunReport {
  const {
    refused: _refused,
    proof: _proof,
    unadmitted: _unadmitted,
    coverage: _coverage,
    ...rest
  } = report;
  return rest;
}
