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
  recorderOption,
  takeRecorded,
  unobservedEnv,
} from "../observe/index.js";
import { ownNodeOptions } from "../process/recorders.js";
import type { WorktreePaths } from "./paths.js";

/**
 * The recorder in one Vitest instance's workers (spec 001 D4; task 001-132;
 * research observed-runtime-inputs F1). Delivered through `createVitest`'s
 * `env` option, which Vitest spreads into every worker of every project, in
 * both pools: the recorder ahead of the daemon's own `NODE_OPTIONS`, as
 * `--import` of its `file:` URL or beside a `--require` as one
 * (`recorderOption`, task 001-390), and the settings. A project whose config sets
 * `env.NODE_OPTIONS` overrides that, so the recorder goes ahead of its value.
 * Each instance writes into its own directory under the daemon's temp
 * directory, read and emptied after each run. An instance that does not
 * observe keeps another Squeal's recorder, inherited when a test runs this
 * one, out of its workers instead (`unobservedEnv`, task 001-431): the
 * settings through the `env` option, `NODE_OPTIONS` per project once the
 * config resolved, so a config's own value stays the project's in the
 * workers and in the hash (review wave 6, B2).
 */
export class VitestObserver {
  #out: AbsolutePath | null = null;
  /** The env the current instance's workers got from the recorder, or in place of another Squeal's. */
  #injected: Record<string, string> = {};
  /** The inherited `NODE_OPTIONS` without another Squeal's recorder, for an instance that does not observe. */
  #cleaned: string | undefined;
  /** The projects that got `#cleaned` for want of a `NODE_OPTIONS` of their config's. */
  #filled = new Set<string>();
  #recorder: AbsolutePath | null | undefined;

  constructor(
    private readonly paths: WorktreePaths,
    private readonly enabled: () => boolean,
  ) {}

  /** The current instance records. */
  get active(): boolean {
    return this.#out !== null;
  }

  /** The recorder file the current instance's workers load: none while it does not record. */
  get files(): readonly AbsolutePath[] {
    return this.#out !== null && this.#recorder ? [this.#recorder] : [];
  }

  /** Policy `observe.runtimeInputs` moved since the instance started: it must be recreated. */
  stale(): boolean {
    return this.enabled() !== (this.active || this.#recorderMissing());
  }

  /** The adapter version the environment hash carries: an observing instance's differs. */
  adapterVersion(base: string): string {
    return this.active ? `${base}+observe.${RECORDER_VERSION}` : base;
  }

  /** What the recorder added to, or took out of, `project`'s env: left out of its environment hash. */
  injectedFor(project: string): Readonly<Record<string, string>> {
    const cleaned = this.#cleaned;
    return cleaned !== undefined && this.#filled.has(project)
      ? { ...this.#injected, NODE_OPTIONS: cleaned }
      : this.#injected;
  }

  /** The `env` option of the next instance: `{}` when it neither observes nor inherits a recorder. */
  start(): { env?: Record<string, string> } {
    this.stop();
    const recorder = this.enabled() ? this.#find() : null;
    if (recorder === null) {
      const { NODE_OPTIONS: cleaned, ...settings } = unobservedEnv(process.env);
      this.#cleaned = cleaned;
      this.#injected = settings;
      return Object.keys(settings).length === 0 ? {} : { env: settings };
    }
    const out = mkdtempSync(join(tmpdir(), "squeal-observe-"));
    this.#out = out;
    // The temp directory is skipped when it lies inside the worktree, never when the worktree lies in it.
    const temp = tmpdir();
    const contains = `${this.paths.root}${sep}`.startsWith(`${temp}${sep}`);
    const settings = { out, root: this.paths.root, skip: contains ? [] : [temp] };
    this.#injected = observeEnv(recorder, settings, process.env.NODE_OPTIONS);
    return { env: this.#injected };
  }

  /**
   * After `standalone()`: a project's own `env.NODE_OPTIONS` gets the
   * recorder first. Without one, under another Squeal's recorder, a
   * config's own value loses that recorder and every project that inherits
   * none, from its config or the root's, gets the inherited value without it.
   */
  configure(vitest: Vitest): void {
    if (this.#cleaned !== undefined) {
      this.#unobserve(vitest, this.#cleaned);
      return;
    }
    const recorder = this.#recorder;
    if (this.#out === null || !recorder) return;
    for (const project of vitest.projects) {
      const env = project.config.env as Record<string, unknown> | undefined;
      const options = env?.NODE_OPTIONS;
      if (env === undefined || typeof options !== "string" || options.includes(recorder)) continue;
      env.NODE_OPTIONS = `${recorderOption(recorder, options)} ${options}`;
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
    this.#cleaned = undefined;
    this.#filled.clear();
  }

  #unobserve(vitest: Vitest, cleaned: string): void {
    const own = (env: Record<string, unknown> | undefined) => {
      const options = env?.NODE_OPTIONS;
      if (env === undefined || typeof options !== "string") return false;
      env.NODE_OPTIONS = ownNodeOptions(options) ?? "";
      return true;
    };
    const root = own(vitest.config.env as Record<string, unknown> | undefined);
    for (const project of vitest.projects) {
      if (own(project.config.env as Record<string, unknown> | undefined) || root) continue;
      project.config.env = { ...project.config.env, NODE_OPTIONS: cleaned };
      this.#filled.add(project.name);
    }
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
