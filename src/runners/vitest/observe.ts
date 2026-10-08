import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  #recorder: AbsolutePath | null | undefined;
  #missingNoted = false;

  constructor(
    private readonly paths: WorktreePaths,
    private readonly enabled: () => boolean,
    private readonly note: (text: string) => void,
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

  /** The `env` option of the next instance, or `{}` when it does not observe. */
  start(): { env?: Record<string, string> } {
    this.stop();
    if (!this.enabled()) return {};
    const recorder = this.#find();
    if (recorder === null) return {};
    const out = mkdtempSync(join(tmpdir(), "squeal-observe-"));
    this.#out = out;
    const settings = { out, root: this.paths.root, skip: [tmpdir()] };
    return { env: observeEnv(recorder, settings, process.env.NODE_OPTIONS) };
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
  }

  #find(): AbsolutePath | null {
    if (this.#recorder === undefined) this.#recorder = observeRecorder();
    if (this.#recorder === null && !this.#missingNoted) {
      this.#missingNoted = true;
      this.note(
        "the runtime-input recorder is missing from this install; runtime reads are not observed",
      );
    }
    return this.#recorder;
  }

  /** Enabled but impossible: the instance needs no recreate for it. */
  #recorderMissing(): boolean {
    return this.#recorder === null;
  }
}
