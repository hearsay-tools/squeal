import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import type { CoverageRun } from "../code/coverage/types.js";
import type { RunnerAdapter, RunOptions, RunReport } from "../types/runner.js";
import { encodeCoverageRun } from "./coverage-wire.js";
import {
  type DaemonMessage,
  encodeLine,
  errorOf,
  frameOf,
  type HostMessage,
  type HostPolicy,
  type HostStart,
  type HostStarted,
  type HostValues,
  RUNNER_HOST_PROTOCOL,
  type WireRunOptions,
} from "./protocol.js";
import type { RunAround } from "./workers.js";

/*
 * Spec 021 D6 (row 021-11): the host's side. It builds the adapter `start`
 * names, answers each request once, and turns the adapter's callbacks into
 * events. It never opens the store. When its input ends it stops its runs,
 * closes the adapter and returns, so the process exits (`runner-split.md`
 * Q6).
 */

/** An adapter a host serves: a Vitest adapter also tells its widths. */
export interface HostedAdapter extends RunnerAdapter {
  widthValues?(): unknown;
}

/** What the adapter's options call, which the host turns into events and policy reads. */
export interface AdapterHooks {
  readonly policy: () => HostPolicy;
  readonly note: (text: string, topic?: string) => void;
  readonly optimizer: (projects: readonly string[]) => void;
  readonly coverage: (run: CoverageRun) => void;
}

export interface ServeOptions {
  /** The daemon's messages: the process's stdin. */
  readonly input: Readable;
  /** Writes one protocol line: the process's own stdout, never a library's. */
  readonly write: (line: string) => void;
  readonly build: (start: HostStart, hooks: AdapterHooks) => Promise<HostedAdapter>;
  /** This Squeal's version, compared at `start`. */
  readonly version: string;
  /** Around each run (`hostWorkers`); absent, the run alone. */
  readonly around?: RunAround;
  /**
   * Around every call that reaches the adapter, its start and close included:
   * the root as the working directory while one is in flight (`inRootWhileAnswering`).
   */
  readonly within?: <T>(call: () => Promise<T>) => Promise<T>;
  /** How long `close` and the input's end wait for the adapter to close. */
  readonly closeMs?: number;
}

const CLOSE_MS = 5_000;

/** Serves the protocol until `close` or the input's end; resolves once the adapter closed. */
export async function serveRunnerHost(options: ServeOptions): Promise<void> {
  const send = (message: HostMessage) => options.write(encodeLine(message));
  const around: RunAround = options.around ?? ((_, run) => run());
  const within = options.within ?? ((call) => call());
  let adapter: HostedAdapter | null = null;
  /** The adapter `start` is building; the input's end closes it once built (review 0.1.434 B4). */
  let building: Promise<HostedAdapter> | null = null;
  let policy: HostPolicy | null = null;
  let sent = "";
  const runs = new Map<number, { signal: AbortController; stop: AbortController }>();
  const forced = new Map<number, () => void>();
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let ending = false;

  const valuesOf = (current: HostedAdapter): HostValues => ({
    omittedTestFiles: current.omittedTestFiles?.() ?? 0,
    widths: current.widthValues?.() ?? null,
  });
  /** A `values` event when they differ from the last sent. */
  const tellValues = () => {
    if (adapter === null) return;
    const values = valuesOf(adapter);
    const text = JSON.stringify(values);
    if (text === sent) return;
    sent = text;
    send({ ev: "values", values });
  };

  /** The adapter, or the one being built once it is: never served once the input ended. */
  const closeAdapter = async (): Promise<void> => {
    const current = adapter ?? (await building?.catch(() => null)) ?? null;
    if (current !== null) await within(() => current.close()).catch(() => {});
  };

  /**
   * Stops every run and closes the adapter, one still being built included,
   * waiting at most `closeMs`; a close past it still runs.
   */
  let stopping: Promise<void> | null = null;
  const stopAll = (): Promise<void> => {
    ending = true;
    stopping ??= (async () => {
      for (const run of runs.values()) {
        run.signal.abort("stop");
        run.stop.abort("stop");
      }
      for (const done of forced.values()) done();
      const closing = closeAdapter();
      let timer: NodeJS.Timeout | undefined;
      const bound = new Promise((resolve) => {
        timer = setTimeout(resolve, options.closeMs ?? CLOSE_MS);
      });
      await Promise.race([closing, bound]);
      clearTimeout(timer);
    })();
    return stopping;
  };

  const hooks: AdapterHooks = {
    policy: () => {
      if (policy === null) throw new Error("runner host: no policy before start");
      return policy;
    },
    note: (text, topic) => send({ ev: "note", text, ...(topic === undefined ? {} : { topic }) }),
    optimizer: (projects) => send({ ev: "optimizer", projects }),
    coverage: (run) => send({ ev: "coverage", run: encodeCoverageRun(run) }),
  };

  const start = async (args: HostStart): Promise<HostStarted> => {
    if (args.protocol !== RUNNER_HOST_PROTOCOL || args.version !== options.version) {
      throw new Error(
        `runner host of Squeal ${options.version} (protocol ${RUNNER_HOST_PROTOCOL}) refuses a daemon of Squeal ${args.version} (protocol ${args.protocol})`,
      );
    }
    if (adapter !== null || building !== null) throw new Error("runner host: started already");
    if (ending) throw new Error("runner host: its input ended before the start");
    policy = args.policy;
    building = options.build(args, hooks);
    let built: HostedAdapter;
    try {
      built = await building;
    } catch (error) {
      building = null;
      throw error;
    }
    // The input ended meanwhile: `stopAll` closes it, and it is never served.
    if (ending) throw new Error("runner host: its input ended during the start");
    adapter = built;
    building = null;
    const values = valuesOf(built);
    sent = JSON.stringify(values);
    return {
      protocol: RUNNER_HOST_PROTOCOL,
      version: options.version,
      host: {
        pid: process.pid,
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },
      adapter: {
        name: built.name,
        adapterVersion: built.adapterVersion,
        focuses: built.focuses === true,
        members: [
          ...(built.recheck === undefined ? [] : ["recheck" as const]),
          ...(built.globalSetups === undefined ? [] : ["globalSetups" as const]),
        ],
      },
      values,
    };
  };

  const run = async (id: number, args: readonly unknown[]): Promise<RunReport> => {
    const current = started();
    const [files, wire] = args as [RunReportFiles, WireRunOptions];
    const signal = new AbortController();
    const stop = new AbortController();
    runs.set(id, { signal, stop });
    const { beforeForce, ...data } = wire;
    const runOptions: RunOptions = {
      ...data,
      signal: signal.signal,
      stop: stop.signal,
      fileEnded: (testFile) => send({ ev: "fileEnded", run: id, testFile }),
      ...(beforeForce === true
        ? {
            beforeForce: (env) =>
              new Promise<void>((resolve) => {
                if (ending) return resolve();
                forced.set(id, resolve);
                send({ ev: "beforeForce", run: id, env });
              }),
          }
        : {}),
    };
    try {
      return await around(runOptions, () => current.run(files, runOptions));
    } finally {
      runs.delete(id);
      forced.get(id)?.();
      forced.delete(id);
    }
  };

  const started = (): HostedAdapter => {
    if (adapter === null) throw new Error("runner host: not started");
    return adapter;
  };

  const answer = async (id: number, method: string, args: readonly unknown[]) => {
    switch (method) {
      case "start":
        return start(args[0] as HostStart);
      case "run":
        return run(id, args);
      case "cancel": {
        const [target, which, reason] = args as [number, "signal" | "stop", unknown];
        const found = runs.get(target);
        found?.[which].abort(reason);
        return found !== undefined;
      }
      case "close":
        await stopAll();
        return true;
      default:
        return call(started(), method, args);
    }
  };

  const handle = (message: DaemonMessage) => {
    if (!("id" in message)) {
      if (message.m === "policy") policy = message.a[0];
      else {
        forced.get(message.a[0])?.();
        forced.delete(message.a[0]);
      }
      return;
    }
    const { id, m, a } = message;
    (m === "cancel" || m === "close" ? answer(id, m, a) : within(() => answer(id, m, a))).then(
      (r) => {
        tellValues();
        send({ id, r: r === undefined ? null : r });
        // The reply is written: the process may exit now.
        if (m === "close") finish();
      },
      (cause: unknown) => {
        tellValues();
        send({ id, e: errorOf(cause) });
      },
    );
  };

  const lines = createInterface({ input: options.input, crlfDelay: Number.POSITIVE_INFINITY });
  lines.on("line", (line) => {
    const frame = frameOf(line);
    if (frame === null) return;
    let message: DaemonMessage;
    try {
      message = JSON.parse(frame) as DaemonMessage;
    } catch {
      process.stderr.write(`runner host: a line that does not parse: ${line.slice(0, 200)}\n`);
      return;
    }
    handle(message);
  });
  lines.on("close", () => void stopAll().then(finish));
  await finished;
  lines.close();
}

type RunReportFiles = Parameters<RunnerAdapter["run"]>[0];

/** The adapter's member `method` with `args`; one it lacks is an error. */
function call(adapter: HostedAdapter, method: string, args: readonly unknown[]): Promise<unknown> {
  switch (method) {
    case "invalidate":
      return adapter.invalidate(args[0] as Parameters<RunnerAdapter["invalidate"]>[0]);
    case "recheck":
      return adapter.recheck?.() ?? Promise.resolve({ recreatedProjects: [] });
    case "affected":
      return adapter.affected(args[0] as Parameters<RunnerAdapter["affected"]>[0]);
    case "closure":
      return adapter.closure(args[0] as Parameters<RunnerAdapter["closure"]>[0]);
    case "enumerate":
      return adapter.enumerate(args[0] as Parameters<RunnerAdapter["enumerate"]>[0]);
    case "testFiles":
      return adapter.testFiles();
    case "globalSetups":
      return adapter.globalSetups?.() ?? Promise.resolve([]);
    case "environment":
      return adapter.environment();
    default:
      return Promise.reject(new Error(`runner host: unknown request ${method}`));
  }
}
