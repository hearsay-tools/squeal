import type { CoverageRun } from "../code/coverage/types.js";
import type { TestFileRef } from "../types/keys.js";
import type {
  AffectedTestFiles,
  EnumeratedCheck,
  GlobalSetupEntry,
  InvalidatedPath,
  InvalidateResult,
  RunnerAdapter,
  RunnerClosure,
  RunnerEnvironment,
  RunOptions,
  RunReport,
} from "../types/runner.js";
import type { HostChannel } from "./channel.js";
import { type Deadline, HostConnection, HostLost } from "./connection.js";
import { decodeCoverageRun } from "./coverage-wire.js";
import type {
  HostAdapterOptions,
  HostEvent,
  HostMethod,
  HostPolicy,
  HostRunner,
  HostStarted,
  HostValues,
  WireRunOptions,
} from "./protocol.js";
import { RUNNER_HOST_PROTOCOL } from "./protocol.js";
import { type Widths, widthsOf } from "./runners.js";

/*
 * Spec 021 D7 (row 021-11): the daemon's side. A `RunnerAdapter` whose
 * members are requests to a runner host; one more `create` under
 * `createRecoveringRunner`. The synchronous members answer from the values
 * the host sent last. A host that exits or misses a deadline makes the run
 * in flight incomplete (`crashed`, `timed-out`: every check of its tier
 * `unknown`) and every other call fail; the proxy is then gone
 * (`runnerHostGone`), and the recovering runner starts a new host.
 */

/** How long the daemon waits for each answer. */
export interface HostDeadlines {
  /** `start`: the project's config loads and the instance starts. */
  readonly startMs: number;
  /** Every other request but `run`; an instance may restart inside one. */
  readonly callMs: number;
  /** A run's beyond its own `timeoutMs`. */
  readonly runMarginMs: number;
  /**
   * A run without a `timeoutMs` (policy `runner.timeoutMs: null`): the
   * longest the host may go without answering it or ending one of its files.
   * The host's liveness, not a test timeout (review 0.1.434 B3).
   */
  readonly runIdleMs: number;
  readonly cancelMs: number;
  /** `close`, then the exit after it. */
  readonly closeMs: number;
}

export const HOST_DEADLINES: HostDeadlines = {
  startMs: 300_000,
  callMs: 300_000,
  runMarginMs: 300_000,
  runIdleMs: 1_800_000,
  cancelMs: 60_000,
  closeMs: 30_000,
};

export interface HostProxyOptions {
  readonly channel: HostChannel;
  readonly runner: HostRunner;
  /** This Squeal's version; a host of another is refused. */
  readonly version: string;
  readonly options: HostAdapterOptions;
  /** Read before each request; sent when it changed. */
  readonly policy: () => HostPolicy;
  readonly note?: (text: string, topic?: string) => void;
  readonly optimizer?: (projects: readonly string[]) => void;
  /** Coverage's `collected`: each run's payloads. */
  readonly coverage?: (run: CoverageRun) => void;
  readonly deadlines?: Partial<HostDeadlines>;
  /**
   * Spec 021 D10 (row 021-13): requests before `start`, such as a remote
   * host's tree and install. The `HostRequests` it gets stay usable after.
   */
  readonly prepare?: (requests: HostRequests) => Promise<void>;
  /** Spec 021 D10: what rides on each `invalidate`, a remote's changed files; `undefined`, nothing. */
  readonly invalidateWith?: (paths: readonly InvalidatedPath[]) => Promise<unknown>;
}

/** Requests to a host beside the adapter's members (spec 021 D10). */
export interface HostRequests {
  request(m: HostMethod, a: readonly unknown[], deadlineMs: number): Promise<unknown>;
}

const gone = new WeakSet<RunnerAdapter>();

/** Whether `adapter` is a proxy whose host can answer no more (`RecoveringRunnerOptions.gone`). */
export function runnerHostGone(adapter: RunnerAdapter): boolean {
  return gone.has(adapter);
}

/** Starts the host's adapter over `channel`; rejects with the host's error, and stops it. */
export async function startHostProxy(options: HostProxyOptions): Promise<RunnerAdapter> {
  const proxy = new HostProxy(options);
  try {
    await proxy.start();
  } catch (error) {
    await proxy.close();
    throw error;
  }
  return proxy;
}

interface OpenRun {
  readonly fileEnded: RunOptions["fileEnded"];
  readonly beforeForce: RunOptions["beforeForce"];
}

class HostProxy implements RunnerAdapter {
  name: string;
  adapterVersion = "";
  focuses?: true;
  recheck?: () => Promise<InvalidateResult>;
  globalSetups?: () => Promise<readonly GlobalSetupEntry[]>;
  readonly #options: HostProxyOptions;
  readonly #deadlines: HostDeadlines;
  readonly #connection: HostConnection;
  readonly #runs = new Map<number, OpenRun>();
  #values: HostValues = { omittedTestFiles: 0, widths: null };
  #widths: Widths | null = null;
  #policy = "";
  #closed: Promise<void> | null = null;
  /** A host lost before its start answered is the start's error, noted as the runner's failure. */
  #started = false;

  constructor(options: HostProxyOptions) {
    this.#options = options;
    this.name = options.runner;
    this.#deadlines = { ...HOST_DEADLINES, ...options.deadlines };
    this.#connection = new HostConnection({
      channel: options.channel,
      label: `the ${options.runner} runner host`,
      event: (message) => this.#event(message),
      lost: (error) => {
        gone.add(this);
        if (this.#started) options.note?.(`${error.message}; a new one starts at the next call`);
      },
    });
  }

  async start(): Promise<void> {
    await this.#options.prepare?.({
      request: (m, a, deadlineMs) => this.#connection.request(m, a, deadlineMs),
    });
    const policy = this.#options.policy();
    this.#policy = JSON.stringify(policy);
    const started = (await this.#connection.request(
      "start",
      [
        {
          protocol: RUNNER_HOST_PROTOCOL,
          version: this.#options.version,
          runner: this.#options.runner,
          options: this.#options.options,
          policy,
        },
      ],
      this.#deadlines.startMs,
    )) as HostStarted;
    if (started.version !== this.#options.version) {
      throw new Error(
        `the runner host is Squeal ${started.version}, the daemon ${this.#options.version}`,
      );
    }
    this.name = started.adapter.name;
    this.adapterVersion = started.adapter.adapterVersion;
    if (started.adapter.focuses) this.focuses = true;
    if (started.adapter.members.includes("recheck"))
      this.recheck = () => this.#call("recheck", []) as Promise<InvalidateResult>;
    if (started.adapter.members.includes("globalSetups"))
      this.globalSetups = () =>
        this.#call("globalSetups", []) as Promise<readonly GlobalSetupEntry[]>;
    this.#take(started.values);
    this.#started = true;
  }

  async invalidate(paths: readonly InvalidatedPath[]): Promise<InvalidateResult> {
    const riding = await this.#options.invalidateWith?.(paths);
    const args = riding === undefined ? [paths] : [paths, riding];
    return (await this.#call("invalidate", args)) as InvalidateResult;
  }

  affected(changedPaths: readonly string[]): Promise<AffectedTestFiles> {
    return this.#call("affected", [changedPaths]) as Promise<AffectedTestFiles>;
  }

  closure(testFile: TestFileRef): Promise<RunnerClosure> {
    return this.#call("closure", [testFile]) as Promise<RunnerClosure>;
  }

  enumerate(testFile: TestFileRef): Promise<readonly EnumeratedCheck[]> {
    return this.#call("enumerate", [testFile]) as Promise<readonly EnumeratedCheck[]>;
  }

  testFiles(): Promise<readonly TestFileRef[]> {
    return this.#call("testFiles", []) as Promise<readonly TestFileRef[]>;
  }

  environment(): Promise<readonly RunnerEnvironment[]> {
    return this.#call("environment", []) as Promise<readonly RunnerEnvironment[]>;
  }

  omittedTestFiles(): number {
    return this.#values.omittedTestFiles;
  }

  slowWidth(testFiles: readonly TestFileRef[]): number {
    return this.#widths?.slowWidth(testFiles) ?? testFiles.length;
  }

  tierWidth(testFile: TestFileRef, grant: number): number {
    return this.#widths?.tierWidth(testFile, grant) ?? grant;
  }

  async run(testFiles: readonly TestFileRef[], options: RunOptions): Promise<RunReport> {
    const begun = Date.now();
    const { signal, stop, fileEnded, beforeForce, ...data } = options;
    const wire: WireRunOptions = {
      ...data,
      ...(beforeForce === undefined ? {} : { beforeForce: true }),
    };
    const id = this.#connection.nextId();
    this.#runs.set(id, { fileEnded, beforeForce });
    const cancel = (which: "signal" | "stop", reason: unknown) => () => {
      const named = typeof reason === "string" ? [reason] : [];
      this.#connection
        .request("cancel", [id, which, ...named], this.#deadlines.cancelMs)
        .catch(() => {});
    };
    const onSignal = () => cancel("signal", signal?.reason)();
    const onStop = () => cancel("stop", stop?.reason)();
    const deadline: Deadline =
      options.timeoutMs === null
        ? { ms: this.#deadlines.runIdleMs, renewable: { progress: "end a file of it" } }
        : { ms: options.timeoutMs + this.#deadlines.runMarginMs };
    try {
      this.#sendPolicy();
      const reply = this.#connection.request("run", [testFiles, wire], deadline, id);
      if (signal?.aborted) onSignal();
      else signal?.addEventListener("abort", onSignal, { once: true });
      if (stop?.aborted) onStop();
      else stop?.addEventListener("abort", onStop, { once: true });
      return (await reply) as RunReport;
    } catch (error) {
      if (!(error instanceof HostLost)) throw error;
      return {
        end: error.timedOut ? "timed-out" : "crashed",
        durationMs: Date.now() - begun,
        completedFiles: [],
        results: [],
        fileErrors: [],
        failure: error.message,
      };
    } finally {
      signal?.removeEventListener("abort", onSignal);
      stop?.removeEventListener("abort", onStop);
      this.#runs.delete(id);
    }
  }

  close(): Promise<void> {
    this.#closed ??= this.#close();
    return this.#closed;
  }

  async #close(): Promise<void> {
    gone.add(this);
    this.#connection.closing();
    const { channel } = this.#options;
    if (this.#connection.lost === null) {
      await this.#connection.request("close", [], this.#deadlines.closeMs).catch(() => {});
    }
    channel.endInput();
    let timer: NodeJS.Timeout | undefined;
    const bound = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, this.#deadlines.closeMs);
    });
    await Promise.race([channel.ended, bound]);
    clearTimeout(timer);
    channel.kill();
  }

  #call(m: HostMethod, a: readonly unknown[]): Promise<unknown> {
    this.#sendPolicy();
    return this.#connection.request(m, a, this.#deadlines.callMs);
  }

  /** The policy, before a request that may read it, when it changed since last sent. */
  #sendPolicy(): void {
    const policy = this.#options.policy();
    const text = JSON.stringify(policy);
    if (text === this.#policy) return;
    this.#policy = text;
    this.#connection.notice({ m: "policy", a: [policy] });
  }

  #take(values: HostValues): void {
    this.#values = values;
    this.#widths = widthsOf(values.widths);
  }

  #event(message: HostEvent): void {
    switch (message.ev) {
      case "note":
        this.#options.note?.(message.text, message.topic);
        return;
      case "optimizer":
        this.#options.optimizer?.(message.projects);
        return;
      case "values":
        this.#take(message.values);
        return;
      case "fileEnded":
        this.#connection.renew(message.run);
        this.#runs.get(message.run)?.fileEnded?.(message.testFile);
        return;
      case "beforeForce": {
        const hook = this.#runs.get(message.run)?.beforeForce;
        const run = message.run;
        void (hook?.(message.env) ?? Promise.resolve())
          .catch(() => {})
          .then(() => this.#connection.notice({ m: "forced", a: [run] }));
        return;
      }
      case "coverage":
        this.#options.coverage?.(decodeCoverageRun(message.run));
        return;
    }
  }
}
