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
import { type ConfigSet, readConfigs } from "./config-set.js";
import { discoverOxlint, type OxlintInstall } from "./discover.js";
import { Preload } from "./preload.js";
import { blobsNow, lintedFiles, type RunContext, resultsOf, runOxlint } from "./run.js";

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

/** D11's keyed variables: which tsgolint runs, which config Vite+ reads. */
export const KEYED_ENV = ["OXLINT_TSGOLINT_PATH", "VP_VERSION"] as const;

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
}

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

  constructor(private readonly options: OxlintProviderOptions) {
    this.guardMs = options.guardMs ?? 5_000;
    this.now = options.now ?? Date.now;
    this.env = options.env ?? process.env;
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
      for (const path of paths) {
        if (!linted.has(path)) continue;
        inputs.set(path, {
          config: ready.configs.inputsOf(path),
          wholeProgram: ready.configs.importPlugin,
        });
      }
      return inputs;
    });
  }

  lint(files: readonly LintFile[]): Promise<LintRunReport | LintOff> {
    return this.serial(async () => {
      const ready = this.ready();
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
      // oxlint counts the named files it linted: fewer means one is ignored now (D11).
      const counted = run.unknown === null ? run.report?.number_of_files : files.length;
      if (counted !== undefined && counted !== files.length) {
        const ignored = await this.ignoredNow(ready.ctx, results);
        if (ignored !== null) return ignored;
      }
      // oxlint reads the files from disk: a result is the given text's only if the bytes still are.
      for (const [path, blob] of blobsNow(this.options.root, texts.keys(), this.format)) {
        const given = files.find((f) => f.path === path);
        const expected = given?.blob ?? blobHash(Buffer.from(given?.text ?? ""), this.format);
        if (blob !== expected) results.set(path, { unknown: "it changed while oxlint ran" });
      }
      return this.report(results, run.held);
    });
  }

  /** Marks each result's file that oxlint no longer lints; off at a third failure. */
  private async ignoredNow(
    ctx: RunContext,
    results: Map<RelativePath, LintFileResult>,
  ): Promise<LintOff | null> {
    const linted = await lintedFiles(ctx, [...results.keys()]);
    const failure = "failure" in linted ? linted.failure : null;
    if (failure !== null && this.failed(failure) !== null) return { off: this.off ?? failure };
    for (const path of results.keys()) {
      if (failure !== null) results.set(path, { unknown: failure });
      else if (!(linted as Set<RelativePath>).has(path)) {
        results.set(path, { unknown: "oxlint does not lint it now" });
      }
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
    });
  }

  /** Discovery and the configs (D11): the declaration, or off. */
  private async load(): Promise<OxlintSnapshot | LintOff> {
    const install = discoverOxlint(this.options.root);
    if ("off" in install) return this.refused(install.off);
    this.install = install;
    this.preload ??= new Preload();
    const configs = await readConfigs(this.context(install, true), (reason) => this.failed(reason));
    if ("off" in configs) return configs.off === null ? this.refused(configs.reason) : configs.off;
    this.configs = configs;
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

  /** `lintedFiles`, a failure counted: `inputs` rejects with its reason (D9). */
  private async linted(
    ctx: RunContext,
    paths: readonly RelativePath[],
  ): Promise<Set<RelativePath>> {
    const linted = await lintedFiles(ctx, paths);
    if (!("failure" in linted)) return linted;
    throw new Error(this.failed(linted.failure)?.off ?? linted.failure);
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
