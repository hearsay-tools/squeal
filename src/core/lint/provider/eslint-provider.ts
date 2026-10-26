import type { AbsolutePath, RelativePath } from "../../types/common.js";
import { eslintFindings } from "../eslint.js";
import type { WorkerAnswer, WorkerCall } from "./protocol.js";
import { lintWorkerScript } from "./script.js";
import { CallError, LintThread, ThreadFailure } from "./thread.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintFile,
  LintFileInputs,
  LintFileResult,
  LintOff,
  LintProvider,
  LintRefresh,
  LintRunReport,
  LintSnapshot,
} from "./types.js";

/*
 * Spec 017 D3, D4, D9: the project's ESLint in its own worker thread, one
 * per project root. Calls run one at a time. A thread that times out,
 * throws or exits gives its call's files `unknown` with the reason, and the
 * next call starts a new one; the third failure in 10 minutes turns the
 * provider off until a refresh above `none` (a config or package change).
 */

export interface EslintProviderOptions {
  readonly root: AbsolutePath;
  /** The worker's script; by default the one beside the running code. */
  readonly script?: string | null;
  /** The daemon's environment; the worker adds `TSESTREE_SINGLE_RUN=false` (D3). */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** D3's guard per file, and per path of `inputs`. */
  readonly guardMs?: number;
  /** The guard of loading ESLint and its config: `open` and `refresh`. */
  readonly loadGuardMs?: number;
  readonly now?: () => number;
}

const FAILURES = 3;
const WINDOW_MS = 10 * 60_000;
const NO_ENV: LintEnvironment = { closure: [], packages: [], program: [], env: {} };

export function eslintProvider(options: EslintProviderOptions): LintProvider {
  return new EslintProvider(options);
}

class EslintProvider implements LintProvider {
  private readonly script: string | null;
  private readonly guardMs: number;
  private readonly loadGuardMs: number;
  private readonly now: () => number;
  private thread: LintThread | null = null;
  private declaration: LintDeclaration | null = null;
  private env: LintEnvironment = NO_ENV;
  private off: string | null = null;
  private failures: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: EslintProviderOptions) {
    this.script = options.script === undefined ? lintWorkerScript() : options.script;
    this.guardMs = options.guardMs ?? 5_000;
    this.loadGuardMs = options.loadGuardMs ?? 30_000;
    this.now = options.now ?? Date.now;
  }

  /** Starts with no failures, as after `close` (D9). */
  open(): Promise<LintDeclaration | LintOff> {
    return this.serial(async () => {
      await this.stop();
      this.off = null;
      this.failures = [];
      const started = await this.start();
      return "off" in started ? started : started.declaration;
    });
  }

  refresh(level: LintRefresh): Promise<LintSnapshot | LintOff> {
    return this.serial(async () => {
      if (level !== "none") {
        this.off = null;
        this.failures = [];
      }
      if (level === "thread") await this.stop();
      for (;;) {
        const started = await this.start();
        if ("off" in started) return started;
        // A thread just started imported everything: any level is in it.
        if (started.started) return { ...this.env, declaration: started.declaration };
        try {
          const fresh = level === "instance";
          const answer = await started.thread.call({ type: "refresh", fresh }, this.loadGuardMs);
          if (answer.type !== "snapshot") throw new Error(`refresh answered ${answer.type}`);
          this.declaration = answer.declaration;
          this.env = answer.env;
          return { ...answer.env, declaration: answer.declaration };
        } catch (error) {
          const off = this.failed(error);
          if (off !== null) return off;
        }
      }
    });
  }

  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>> {
    return this.serial(async () => {
      const answer = await this.call({ type: "inputs", paths }, this.guardMs);
      if ("off" in answer) throw new Error(answer.off);
      if (answer.type !== "inputs") throw new Error(`inputs answered ${answer.type}`);
      return new Map(answer.inputs);
    });
  }

  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff> {
    return this.serial(async () => {
      let answer: WorkerAnswer | LintOff;
      try {
        answer = await this.call({ type: "lint", files }, this.guardMs);
      } catch (error) {
        if (this.off !== null) return { off: this.off };
        const reason = error instanceof Error ? error.message : String(error);
        const results = new Map(files.map((f) => [f.path, { unknown: reason }]));
        return { ...this.env, results };
      }
      if ("off" in answer) return answer;
      if (answer.type !== "linted") throw new Error(`lint answered ${answer.type}`);
      this.env = answer.env;
      const texts = new Map(files.map((f) => [f.path, f.text]));
      const results = new Map<RelativePath, LintFileResult>();
      for (const [path, result] of answer.results) {
        results.set(
          path,
          "unknown" in result
            ? result
            : { findings: eslintFindings(result.messages, texts.get(path) ?? "") },
        );
      }
      return { ...answer.env, results };
    });
  }

  close(): Promise<void> {
    return this.serial(() => this.stop());
  }

  /** A call on a live thread; a failure is counted, then thrown on. */
  private async call(message: WorkerCall, guardMs: number): Promise<WorkerAnswer | LintOff> {
    const started = await this.start();
    if ("off" in started) return started;
    try {
      return await started.thread.call(message, guardMs);
    } catch (error) {
      if (error instanceof ThreadFailure) this.failed(error);
      throw error instanceof CallError || error instanceof ThreadFailure
        ? new Error(error.message)
        : error;
    }
  }

  /** The live thread, or a new one opened and refreshed; `off` when off or refused. */
  private async start(): Promise<
    { thread: LintThread; declaration: LintDeclaration; started: boolean } | LintOff
  > {
    for (;;) {
      if (this.off !== null) return { off: this.off };
      if (this.thread?.alive && this.declaration !== null) {
        return { thread: this.thread, declaration: this.declaration, started: false };
      }
      if (this.script === null) return { off: "the ESLint worker's script is not built" };
      const thread = new LintThread({
        script: this.script,
        root: this.options.root,
        env: { ...(this.options.env ?? process.env), TSESTREE_SINGLE_RUN: "false" },
        onIdle: (reason) => {
          if (this.thread === thread) this.failed(new ThreadFailure(reason));
        },
      });
      this.thread = thread;
      this.declaration = null;
      this.env = NO_ENV;
      try {
        const opened = await thread.call({ type: "open" }, this.loadGuardMs);
        if (opened.type === "off") {
          // Refused, not failed: off until a refresh above `none` (D9).
          await this.stop();
          this.off = opened.reason;
          return { off: opened.reason };
        }
        const answer = await thread.call({ type: "refresh", fresh: false }, this.loadGuardMs);
        if (answer.type !== "snapshot") throw new Error(`refresh answered ${answer.type}`);
        this.declaration = answer.declaration;
        this.env = answer.env;
        return { thread, declaration: answer.declaration, started: true };
      } catch (error) {
        const off = this.failed(error);
        if (off !== null) return off;
      }
    }
  }

  /** Counts a thread failure; the provider's `off` once it is the third in 10 minutes. */
  private failed(error: unknown): LintOff | null {
    if (!(error instanceof ThreadFailure)) throw error;
    this.thread = null;
    this.declaration = null;
    const at = this.now();
    this.failures = [...this.failures.filter((t) => at - t < WINDOW_MS), at];
    if (this.failures.length < FAILURES) return null;
    this.off = `the ESLint worker failed ${FAILURES} times; ${error.message}`;
    return { off: this.off };
  }

  private async stop(): Promise<void> {
    const thread = this.thread;
    this.thread = null;
    this.declaration = null;
    await thread?.terminate();
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
