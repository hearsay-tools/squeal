import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import type { Vitest } from "vitest/node";
import type { AbsolutePath, ObservedInputs, TestFileRef } from "../../core/types/index.js";
import {
  observedInputs,
  observeEnv,
  observeRecorder,
  RECORDER_VERSION,
  takeRecorded,
} from "../observe/index.js";
import type { WorktreePaths } from "./paths.js";

/**
 * The recorder in one Vitest instance's workers (spec 001 D4; task 001-132;
 * research observed-runtime-inputs F1). Delivered through `createVitest`'s
 * `env` option, which Vitest spreads into every worker of every project, in
 * both pools: `--require <recorder>` ahead of the daemon's own
 * `NODE_OPTIONS`, and the settings. A project whose config sets
 * `env.NODE_OPTIONS` overrides that, so the recorder goes ahead of its value.
 * Each instance writes into its own directory under the daemon's temp
 * directory, read and emptied after each run.
 */
export class VitestObserver {
  #out: AbsolutePath | null = null;
  /** The env the current instance's workers got from the recorder. */
  #injected: Record<string, string> = {};
  #recorder: AbsolutePath | null | undefined;

  constructor(
    private readonly paths: WorktreePaths,
    private readonly enabled: () => boolean,
  ) {}

  /** The current instance records. */
  get active(): boolean {
    return this.#out !== null;
  }

  /** Policy `observe.runtimeInputs` moved since the instance started: it must be recreated. */
  stale(): boolean {
    return this.enabled() !== (this.active || this.#recorderMissing());
  }

  /** The adapter version the environment hash carries: an observing instance's differs. */
  adapterVersion(base: string): string {
    return this.active ? `${base}+observe.${RECORDER_VERSION}` : base;
  }

  /** What the recorder added to the current instance's env: left out of the environment hash. */
  get injected(): Readonly<Record<string, string>> {
    return this.#injected;
  }

  /** The `env` option of the next instance, or `{}` when it does not observe. */
  start(): { env?: Record<string, string> } {
    this.stop();
    if (!this.enabled()) return {};
    const recorder = this.#find();
    if (recorder === null) return {};
    const out = mkdtempSync(join(tmpdir(), "squeal-observe-"));
    this.#out = out;
    // The temp directory is skipped when it lies inside the worktree, never when the worktree lies in it.
    const temp = tmpdir();
    const contains = `${this.paths.root}${sep}`.startsWith(`${temp}${sep}`);
    const settings = { out, root: this.paths.root, skip: contains ? [] : [temp] };
    this.#injected = observeEnv(recorder, settings, process.env.NODE_OPTIONS);
    return { env: this.#injected };
  }

  /** After `standalone()`: a project's own `env.NODE_OPTIONS` gets the recorder first. */
  configure(vitest: Vitest): void {
    const recorder = this.#recorder;
    if (this.#out === null || !recorder) return;
    for (const project of vitest.projects) {
      const env = project.config.env as Record<string, unknown> | undefined;
      const options = env?.NODE_OPTIONS;
      if (env === undefined || typeof options !== "string" || options.includes(recorder)) continue;
      env.NODE_OPTIONS = `--require ${JSON.stringify(recorder)} ${options}`;
    }
  }

  /** What the run's completed files were observed to read; `undefined` when not observing. */
  take(completed: readonly TestFileRef[]): ObservedInputs[] | undefined {
    if (this.#out === null) return undefined;
    return observedInputs(takeRecorded(this.#out), completed, this.paths);
  }

  /** Drops the current instance's directory. */
  stop(): void {
    if (this.#out !== null) rmSync(this.#out, { recursive: true, force: true });
    this.#out = null;
    this.#injected = {};
  }

  /**
   * The recorder file. A build that did not copy it (`tsc` alone, which
   * emits no `.cjs`) observes nothing and keys as with the policy off; the
   * plugin bundles carry it in `dist/observe/` (`src/harness/build.ts`).
   */
  #find(): AbsolutePath | null {
    if (this.#recorder === undefined) this.#recorder = observeRecorder();
    return this.#recorder;
  }

  /** Enabled but impossible: the instance needs no recreate for it. */
  #recorderMissing(): boolean {
    return this.#recorder === null;
  }
}
