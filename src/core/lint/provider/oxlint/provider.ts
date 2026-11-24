import { existsSync } from "node:fs";
import { join } from "node:path";
import { blobHash, type ObjectFormat } from "../../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../../types/common.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintFile,
  LintFileInputs,
  LintFileResult,
  LintHeld,
  LintOff,
  LintRefresh,
  LintRunReport,
} from "../../pass/provider.js";
import { defaultCache, LintedMemo, type OxlintCache } from "./cache.js";
import { type ConfigSet, readConfigs, VITE_PLUS_OFF } from "./config-set.js";
import type { FolderConfigs } from "./configs.js";
import { discoverOxlint, type OxlintInstall } from "./discover.js";
import { Preload } from "./preload.js";
import {
  blobsNow,
  debugFiles,
  type OxlintRun,
  type RunContext,
  resultsOf,
  runOxlint,
} from "./run.js";

/*
 * Spec 017 D11: the project's own oxlint as a lint provider, shaped after
 * the pass's `LintProvider` (row 017-14; the pass takes it in row 017-15).
 * Nothing is kept warm: each `lint` is a fresh process over its files, so
 * D4's levels do not apply and every refresh above `none` reads the configs
 * again. A run that times out, throws or exits gives its files `unknown`;
 * the third such failure in 10 minutes turns it off until a refresh above
 * `none` (D9). Where `LintProvider` does not fit: `tasks/017-14/notes.md`.
 */

/** In every key (D5): raise it when what the provider reports changes meaning. */
export const OXLINT_PROVIDER_VERSION = 1;

/** D11's keyed variables: which tsgolint runs. With `VP_VERSION` set the provider is off (N3). */
export const KEYED_ENV = ["OXLINT_TSGOLINT_PATH"] as const;

export interface OxlintDeclaration extends Omit<LintDeclaration, "tool"> {
  readonly tool: "oxlint";
}
export interface OxlintSnapshot extends LintEnvironment {
  readonly declaration: OxlintDeclaration;
}

/** `LintProvider` with an oxlint declaration: the change it needs is in the notes. */
export interface OxlintProvider {
  open(format?: ObjectFormat): Promise<OxlintDeclaration | LintOff>;
  refresh(level: LintRefresh): Promise<OxlintSnapshot | LintOff>;
  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>>;
  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff>;
  close(): Promise<void>;
}

export interface OxlintProviderOptions {
  readonly root: AbsolutePath;
  /** The daemon's environment. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** D3's guard per run: a part, `--debug files`, `--print-config`. */
  readonly guardMs?: number;
  /** The Node that runs oxlint; the daemon's own by default. */
  readonly node?: string;
  readonly now?: () => number;
  /** Spec 026 D3's cache of config reads; the worktree's `lint.sqlite` by default. */
  readonly cache?: OxlintCache;
}

/** Files `inputs` reads between two yields to the event loop (issue #274 F3.5). */
export const YIELD_EVERY = 256;

/** The files oxlint lints by extension; one of these is linted unless an ignore names it. */
const LINTED_EXTENSIONS = /(?<!\.d)\.(?:[cm]?[jt]s|[jt]sx)$/;

const FAILURES = 3;
const WINDOW_MS = 10 * 60_000;

export function oxlintProvider(options: OxlintProviderOptions): OxlintProvider {
  return new Provider(options);
}

class Provider implements OxlintProvider {
  private readonly guardMs: number;
  private readonly now: () => number;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private format: ObjectFormat = "sha1";
  private install: OxlintInstall | null = null;
  private configs: ConfigSet | null = null;
  private declaration: OxlintDeclaration | null = null;
  private closure = new Set<RelativePath>();
  private held: ReadonlyMap<RelativePath, LintHeld> = new Map();
  private preload: Preload | null = null;
  private abort = new AbortController();
  private off: string | null = null;
  private failures: number[] = [];
  private queue: Promise<unknown> = Promise.resolve();
  private readonly cache: OxlintCache;
  /** Whether oxlint lints each path, under the current configs' key (spec 026 D3). */
  private memo: LintedMemo | null = null;

  constructor(private readonly options: OxlintProviderOptions) {
    this.guardMs = options.guardMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
    this.cache = options.cache ?? defaultCache();
  }

  open(format: ObjectFormat = "sha1"): Promise<OxlintDeclaration | LintOff> {
    return this.serial(async () => {
      this.format = format;
      this.off = null;
      this.failures = [];
      const loaded = await this.load();
      return "off" in loaded ? loaded : loaded.declaration;
    });
  }

  refresh(level: LintRefresh): Promise<OxlintSnapshot | LintOff> {
    return this.serial(async () => {
      if (level !== "none") {
        this.off = null;
        this.failures = [];
        this.declaration = null;
      }
      if (this.off !== null) return { off: this.off };
      if (this.declaration !== null) return this.snapshot(this.declaration);
      return this.load();
    });
  }

  inputs(paths: readonly RelativePath[]): Promise<ReadonlyMap<RelativePath, LintFileInputs>> {
    return this.serial(async () => {
      const ready = this.ready();
      if ("off" in ready) throw new Error(ready.off);
      const linted = await this.linted(ready.ctx, paths);
      const inputs = new Map<RelativePath, LintFileInputs>();
      const folders: FolderConfigs = new Map();
      for (let i = 0; i < paths.length; i++) {
        // Issue #274 F3.5: a large batch never holds the main thread in one block.
        if (i > 0 && i % YIELD_EVERY === 0) await new Promise((r) => setImmediate(r));
        const path = paths[i] as RelativePath;
        if (linted.get(path) !== true) continue;
        inputs.set(path, {
          config: ready.configs.inputsOf(path, folders),
          wholeProgram: ready.configs.importPlugin,
        });
      }
      return inputs;
    });
  }

  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff> {
    return this.serial(async () => {
      const read = this.ready();
      // Row 017-30: a config the last read did not find decides a file; the report holds its bytes.
      const stale = !("off" in read) && files.some((f) => read.configs.missed(f.path));
      const ready = stale ? await this.load().then((l) => ("off" in l ? l : this.ready())) : read;
      if ("off" in ready) return ready;
      const texts = new Map(files.map((f) => [f.path, f.text]));
      const above = ready.configs.above;
      if (above !== null) {
        const reason = `a config above the root applies: ${above}`;
        return this.report(new Map(files.map((f) => [f.path, { unknown: reason }])), new Map());
      }
      if (files.length === 0) return this.report(new Map(), new Map());
      const args = ["--format", "json", "--threads", "1", "--", ...texts.keys()];
      const run = await runOxlint(ready.ctx, args);
      if (run.failure !== null && this.failed(run.failure) !== null) return { off: this.off ?? "" };
      const results = resultsOf(run, texts);
      const counted = await this.counted(ready.ctx, run, results);
      if (counted !== null) return counted;
      // oxlint reads the files from disk: a result is the given text's only if the bytes still are.
      for (const [path, blob] of blobsNow(this.options.root, texts.keys(), this.format)) {
        const given = files.find((f) => f.path === path);
        const expected = given?.blob ?? blobHash(Buffer.from(given?.text ?? ""), this.format);
        if (blob !== expected) results.set(path, { unknown: "it changed while oxlint ran" });
      }
      return this.report(results, run.held);
    });
  }

  /**
   * oxlint counts the named files it linted (D11): all of them are linted,
   * kept so no pass asks again (review 0.1.616 B3); fewer means one is
   * ignored now, which `--debug files` names. Off at a third failure.
   */
  private async counted(
    ctx: RunContext,
    run: OxlintRun,
    results: Map<RelativePath, LintFileResult>,
  ): Promise<LintOff | null> {
    if (run.unknown !== null) return null;
    const counted = run.report?.number_of_files;
    if (counted === undefined) return null;
    if (counted !== results.size) return this.ignoredNow(ctx, results);
    await this.memo?.remember([...results.keys()], new Set(results.keys()));
    return null;
  }

  /** Marks each result's file that oxlint no longer lints; off at a third failure. */
  private async ignoredNow(
    ctx: RunContext,
    results: Map<RelativePath, LintFileResult>,
  ): Promise<LintOff | null> {
    const debug = await debugFiles(ctx, [...results.keys()]);
    const failure = "failure" in debug ? debug.failure : null;
    if (failure !== null && this.failed(failure) !== null) return { off: this.off ?? failure };
    const linted = "failure" in debug ? new Set<RelativePath>() : debug.linted;
    for (const path of results.keys()) {
      if (failure !== null) results.set(path, { unknown: failure });
      else if (!linted.has(path)) results.set(path, { unknown: "oxlint does not lint it now" });
    }
    if (!("failure" in debug) && debug.loaded) {
      await this.memo?.remember([...results.keys()], linted);
    }
    return null;
  }

  close(): Promise<void> {
    return this.serial(async () => {
      this.abort.abort();
      this.abort = new AbortController();
      this.preload?.remove();
      this.preload = null;
      this.declaration = null;
      this.install = null;
      this.configs = null;
      this.memo = null;
      await this.cache.close();
    });
  }

  /** Discovery and the configs (D11): the declaration, or off. */
  private async load(): Promise<OxlintSnapshot | LintOff> {
    const install = discoverOxlint(this.options.root);
    if ("off" in install) return this.refused(install.off);
    if (this.env.VP_VERSION !== undefined) return this.refused(VITE_PLUS_OFF);
    this.install = install;
    this.preload ??= new Preload();
    const configs = await readConfigs(
      this.context(install, true),
      (reason) => this.failed(reason),
      this.cache,
    );
    if ("off" in configs) return configs.off === null ? this.refused(configs.reason) : configs.off;
    this.configs = configs;
    this.memo =
      configs.entry === null ? null : new LintedMemo(this.cache, this.options.root, configs.entry);
    this.closure = new Set(configs.closure);
    this.held = configs.held;
    this.declaration = {
      tool: "oxlint",
      toolVersion: install.version,
      providerVersion: OXLINT_PROVIDER_VERSION,
      configFiles: configs.configFiles,
    };
    return this.snapshot(this.declaration);
  }

  private ready(): { ctx: RunContext; configs: ConfigSet } | LintOff {
    if (this.off !== null) return { off: this.off };
    if (this.install === null || this.configs === null || this.declaration === null) {
      return { off: "the oxlint provider is not open" };
    }
    return { ctx: this.context(this.install, this.configs.javascript), configs: this.configs };
  }

  private context(install: OxlintInstall, observe: boolean): RunContext {
    if (this.preload === null) throw new Error("the oxlint provider is not open");
    return {
      root: this.options.root,
      node: this.options.node ?? process.execPath,
      install,
      preload: this.preload,
      observe,
      format: this.format,
      env: this.env,
      guardMs: this.guardMs,
      signal: this.abort.signal,
    };
  }

  /**
   * Whether oxlint lints each of `paths`: the memo's answer, `--debug files`
   * for the rest (spec 026 D3). A failure is counted: `inputs` rejects with
   * its reason (D9). Review 0.1.616 B3: once this config read has classified
   * a path, a new file with a linted extension is taken as linted unasked;
   * `lint` classifies it from the report's count, with `--debug files` only
   * when oxlint lints fewer files than named.
   */
  private async linted(
    ctx: RunContext,
    paths: readonly RelativePath[],
  ): Promise<ReadonlyMap<RelativePath, boolean>> {
    const answers = this.memo?.known(paths) ?? new Map<RelativePath, boolean>();
    const warm = this.memo?.warm === true;
    const asked = paths.filter((path) => {
      if (answers.has(path)) return false;
      if (!warm || !this.likelyLinted(path)) return true;
      answers.set(path, true);
      return false;
    });
    if (asked.length === 0) return answers;
    const debug = await debugFiles(ctx, asked);
    if ("failure" in debug) throw new Error(this.failed(debug.failure)?.off ?? debug.failure);
    for (const path of asked) answers.set(path, debug.linted.has(path));
    // A config that does not load names every file: not an answer to keep.
    if (debug.loaded) await this.memo?.remember(asked, debug.linted);
    return answers;
  }

  private likelyLinted(path: RelativePath): boolean {
    return LINTED_EXTENSIONS.test(path) && existsSync(join(this.options.root, path));
  }

  private report(
    results: Map<RelativePath, LintFileResult>,
    held: ReadonlyMap<RelativePath, LintHeld>,
  ): LintRunReport {
    const all = new Map(held);
    for (const path of held.keys())
      if (existsSync(join(this.options.root, path))) this.closure.add(path);
    // The configs oxlint's native side read: their bytes now, as held (D11).
    const native = [...(this.declaration?.configFiles ?? []), ...(this.configs?.closure ?? [])];
    for (const [path, blob] of blobsNow(this.options.root, native, this.format)) {
      if (!all.has(path) && blob !== null) all.set(path, { others: [blob] });
    }
    this.held = all;
    return { ...this.environment(), results };
  }

  private snapshot(declaration: OxlintDeclaration): OxlintSnapshot {
    return { ...this.environment(), declaration };
  }

  private environment(): LintEnvironment {
    const env: Record<string, string> = {};
    for (const name of KEYED_ENV) {
      const value = this.env[name];
      if (value !== undefined) env[name] = value;
    }
    return {
      closure: [...this.closure].sort(),
      packages: ["oxlint"],
      program: [],
      env,
      held: this.held,
    };
  }

  private refused(reason: string): LintOff {
    this.off = reason;
    this.declaration = null;
    return { off: reason };
  }

  /** Counts a run's failure; off once it is the third in 10 minutes. */
  private failed(reason: string): LintOff | null {
    const at = this.now();
    this.failures = [...this.failures.filter((t) => at - t < WINDOW_MS), at];
    if (this.failures.length < FAILURES) return null;
    return this.refused(`the oxlint run failed ${FAILURES} times; ${reason}`);
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const run = this.queue.then(work, work);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
