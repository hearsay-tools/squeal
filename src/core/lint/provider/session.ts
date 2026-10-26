import { readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { ObjectFormat } from "../../hash/blob.js";
import type { AbsolutePath, RelativePath } from "../../types/common.js";
import type { EslintMessage } from "../eslint.js";
import type {
  LintDeclaration,
  LintEnvironment,
  LintFile,
  LintFileInputs,
} from "../pass/provider.js";
import { keyPath, projectPath, sortLoaded } from "./loaded.js";
import type { Observer } from "./observe.js";
import {
  findTsconfigs,
  loadedTypeScript,
  namedTsconfigs,
  ProgramReader,
  parseTsconfig,
  type TsProgram,
  type TypedOptions,
} from "./program.js";
import {
  firstLine,
  PROVIDER_VERSION,
  ROOT_TOKEN,
  type WorkerDelta,
  type WorkerFileResult,
} from "./protocol.js";
import { lintSignals } from "./signals.js";

/*
 * Spec 017 D3 to D5, in the worker thread: the project's own ESLint, found
 * from the project root as eslint_d finds it (`eslint-provider.md` Q1),
 * with `cwd` given, since a worker cannot `chdir`.
 */

/** The variables keyed with every file (D5), as the worker sees them. */
const KEYED_ENV = ["ESLINT_USE_FLAT_CONFIG", "TSESTREE_SINGLE_RUN"] as const;

/** A path no project holds, whose config loads the root config. */
const PROBE = "squeal-config-probe.js";

interface Parser {
  parseForESLint?(text: string, options: object): { services?: { program?: TsProgramLike } };
}
interface TsProgramLike {
  getSourceFiles(): readonly { readonly fileName: string }[];
  getCompilerOptions(): {
    configFilePath?: unknown;
    configFile?: { extendedSourceFiles?: string[] };
  };
}
interface LiveConfig {
  readonly languageOptions?: {
    readonly parser?: Parser;
    readonly parserOptions?: TypedOptions & Readonly<Record<string, unknown>>;
    readonly ecmaVersion?: unknown;
    readonly sourceType?: unknown;
  };
}
interface Eslint {
  calculateConfigForFile(path: string): Promise<LiveConfig | undefined>;
  lintText(
    text: string,
    options: { filePath: string; warnIgnored: boolean },
  ): Promise<readonly { readonly messages: readonly RawMessage[] }[]>;
  findConfigFile(path?: string): Promise<string | undefined>;
}
interface EslintClass {
  new (options: { cwd: string }): Eslint;
  readonly configType?: string;
}
interface RawMessage {
  readonly ruleId: string | null;
  readonly severity: 1 | 2;
  readonly message: string;
  readonly line?: number;
  readonly column?: number;
}

/** A call the worker answers with an error and lives on (D9). */
export class ConfigError extends Error {}

/** A config whose load the worker did not see: the provider is off (review 0.1.348 B2). */
export class Unobserved extends Error {}

export class EslintSession {
  private eslint: Eslint;
  /** The tsconfigs typed configs read; found once per instance. */
  private relevant: AbsolutePath[] | null = null;
  private program: TsProgram = { tsconfigs: [], files: [] };
  private reader: ProgramReader | null = null;
  /** Program files and tsconfigs learned from a lint, kept for the thread's life. */
  private readonly learned = { tsconfigs: new Set<RelativePath>(), files: new Set<RelativePath>() };
  /** A typed config, to feed a program file ESLint does not lint. */
  private feeder: LiveConfig | null = null;
  /** Each config file ESLint used, its load seen: in the closure for the thread's life. */
  private readonly configs = new Set<AbsolutePath>();
  /** The walk's reads and lookups as the host was last told them (wave 1.7). */
  private readonly told = {
    walked: new Map<RelativePath, string>(),
    lookups: new Map<RelativePath, string>(),
  };

  private constructor(
    private readonly given: AbsolutePath,
    private readonly root: AbsolutePath,
    private readonly version: string,
    private readonly ESLint: EslintClass,
    private readonly observer: Observer,
    private readonly format: ObjectFormat,
  ) {
    this.eslint = new ESLint({ cwd: root });
  }

  /** D3 discovery; `off` with D9's reason. */
  static async open(
    given: AbsolutePath,
    observer: Observer,
    format: ObjectFormat = "sha1",
  ): Promise<EslintSession | { readonly off: string }> {
    const root = realpathSync(given);
    const require = createRequire(join(root, "package.json"));
    let manifest: string;
    try {
      manifest = require.resolve("eslint/package.json");
    } catch {
      return { off: `no ESLint installed in ${given}` };
    }
    const version = String(JSON.parse(readFileSync(manifest, "utf8")).version);
    const major = Number.parseInt(version, 10);
    if (major !== 9 && major !== 10) return { off: `ESLint ${major} is not supported` };
    const api = (await import(pathToFileURL(require.resolve("eslint")).href)) as {
      readonly ESLint: EslintClass;
      readonly loadESLint?: (options: { cwd: string }) => Promise<EslintClass>;
    };
    const ESLint = api.loadESLint ? await api.loadESLint({ cwd: root }) : api.ESLint;
    if (ESLint.configType !== undefined && ESLint.configType !== "flat") {
      return { off: "eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*" };
    }
    return new EslintSession(given, root, version, ESLint, observer, format);
  }

  async declaration(): Promise<LintDeclaration> {
    const config = await this.eslint.findConfigFile().catch(() => undefined);
    const rel = config === undefined ? null : projectPath(config, this.root);
    return {
      tool: "eslint",
      toolVersion: this.version,
      providerVersion: PROVIDER_VERSION,
      configFiles: rel === null ? [] : [rel],
    };
  }

  /** D4 `instance`: a new `ESLint`, which imports the config again. */
  fresh(): void {
    this.eslint = new this.ESLint({ cwd: this.root });
    this.relevant = null;
    this.feeder = null;
  }

  /**
   * Loads the config and reads the program again; a config that does not
   * load is told by `inputs` and `lint`. `moved` when a name the program
   * kept resolves to another file (Q1) or a tsconfig's root files changed.
   * Throws `Unobserved`.
   */
  async refreshed(): Promise<{ readonly env: LintEnvironment; readonly moved: boolean }> {
    await this.computed(join(this.root, PROBE)).catch((error: unknown) => {
      if (error instanceof Unobserved) throw error;
    });
    const ts = loadedTypeScript(sortLoaded(this.observer.urls, this.root).packages);
    if (ts !== null) {
      this.relevant ??= await this.typedTsconfigs(ts);
      if (this.reader?.ts !== ts) {
        this.reader = new ProgramReader(ts, this.root, Date.now, this.format);
      }
      this.program = this.reader.read(this.relevant);
    }
    return { env: this.environment(), moved: this.program.moved === true };
  }

  /**
   * What changed since the last call (wave 1.7 W3): what the thread holds
   * of each path it used since, and the walk's reads and lookups.
   */
  delta(): WorkerDelta {
    const told = (sent: Map<RelativePath, string>, now: ReadonlyMap<AbsolutePath, string>) => {
      const fresh = new Map<RelativePath, string>();
      for (const [path, value] of now) {
        const rel = keyPath(path, [this.root, this.given]);
        if (rel !== null) fresh.set(rel, value);
      }
      const out: (readonly [RelativePath, string | null])[] = [];
      for (const [path, value] of fresh) if (sent.get(path) !== value) out.push([path, value]);
      for (const path of sent.keys()) if (!fresh.has(path)) out.push([path, null]);
      sent.clear();
      for (const [path, value] of fresh) sent.set(path, value);
      return out;
    };
    return {
      held: this.observer.delta(),
      walked: told(this.told.walked, this.program.walked ?? new Map()),
      lookups: told(this.told.lookups, this.program.lookups ?? new Map()),
    };
  }

  environment(): LintEnvironment {
    const sets = sortLoaded(this.observer.urls, this.root);
    const env: Record<string, string> = {};
    for (const name of KEYED_ENV) {
      const value = process.env[name];
      if (value !== undefined) env[name] = value;
    }
    const configs = [...this.configs].flatMap((file) => this.keyPath(file) ?? []);
    return {
      closure: union(sets.closure, configs, this.program.tsconfigs, this.learned.tsconfigs),
      packages: sets.packages,
      program: union(this.program.files, this.learned.files),
      env,
    };
  }

  async inputs(
    paths: readonly RelativePath[],
    progress: () => void,
  ): Promise<(readonly [RelativePath, LintFileInputs])[]> {
    const out: (readonly [RelativePath, LintFileInputs])[] = [];
    for (const path of paths) {
      const config = await this.configOf(path);
      progress();
      if (typeof config === "string") throw new ConfigError(config);
      if (config === undefined) continue;
      const json = this.rootless(JSON.stringify(config));
      const signals = lintSignals(JSON.parse(json));
      out.push([path, { config: json, wholeProgram: signals.typed || signals.crossFile }]);
    }
    return out;
  }

  /**
   * Lints `files` with the kept instance. Typed files and the program files
   * ESLint does not lint are fed to TypeScript's project service first, so
   * each typed file reads the call's text of the others (D5 step 1); a fed
   * file ESLint does not lint gets no result.
   */
  async lint(
    files: readonly LintFile[],
    progress: () => void,
  ): Promise<(readonly [RelativePath, WorkerFileResult])[]> {
    const results: (readonly [RelativePath, WorkerFileResult])[] = [];
    const told = (path: RelativePath, result: WorkerFileResult) => results.push([path, result]);
    const linted: LintFile[] = [];
    const feed: { file: LintFile; config: LiveConfig; lints: boolean }[] = [];
    for (const file of files) {
      const config = await this.configOf(file.path);
      if (typeof config === "string") told(file.path, { unknown: config });
      else if (config !== undefined) {
        linted.push(file);
        if (typed(config)) {
          this.feeder ??= config;
          feed.push({ file, config, lints: true });
        }
      } else if (this.inProgram(file.path) && this.feeder !== null) {
        feed.push({ file, config: this.feeder, lints: false });
      } else told(file.path, { unknown: "ESLint does not lint this file" });
    }
    // One typed file alone reads the others from the service as they are; a
    // file outside the known program is parsed once to learn its program.
    const alone = feed.length === 1 && feed[0]?.lints === true;
    const feeding = !alone ? feed : feed.filter(({ file }) => !this.inProgram(file.path));
    for (const { file, config } of feeding) {
      this.learn(this.parse(file, config));
      this.gave(file);
      progress();
    }
    const typedFiles = new Set(feed.filter((f) => f.lints).map(({ file }) => file));
    for (const file of linted) {
      told(file.path, await this.lintOne(file));
      if (typedFiles.has(file)) this.gave(file);
      progress();
    }
    // Wave 1.8: once ESLint code started a worker thread, what it read there is not observed.
    const blind = this.observer.blind;
    if (blind === null) return results;
    return results.map(([path, result]) => [
      path,
      "unknown" in result ? result : { unknown: blind },
    ]);
  }

  /** TypeScript's service holds `file`'s text now, at the blob the pass read it at (wave 1.7). */
  private gave(file: LintFile): void {
    if (file.blob !== undefined) this.observer.gave(file.path, file.blob);
  }

  private async lintOne(file: LintFile): Promise<WorkerFileResult> {
    let results: Awaited<ReturnType<Eslint["lintText"]>>;
    try {
      results = await this.eslint.lintText(file.text, {
        filePath: join(this.root, file.path),
        warnIgnored: false,
      });
    } catch (error) {
      return { unknown: `ESLint failed on this file: ${firstLine(error)}` };
    }
    const result = results[0];
    if (result === undefined) return { unknown: "ESLint does not lint this file" };
    return { messages: result.messages.map(message) };
  }

  /**
   * The file's computed config; `undefined` when ESLint does not lint it;
   * D9's reason when the config does not load. Throws `Unobserved`.
   */
  private async configOf(path: RelativePath): Promise<LiveConfig | undefined | string> {
    const abs = join(this.root, path);
    try {
      return await this.computed(abs);
    } catch (error) {
      if (error instanceof Unobserved) throw error;
      if (noConfig(error)) return undefined;
      const config = await this.eslint.findConfigFile(abs).catch(() => undefined);
      const name = (config && projectPath(config, this.root)) ?? "eslint.config.js";
      return `${name} does not load: ${firstLine(error)}`;
    }
  }

  /**
   * `calculateConfigForFile` with its config's load observed (D4). The
   * config file joins the closure, as ESLint's own name for it: one whose
   * load the worker did not see throws `Unobserved`.
   */
  private async computed(abs: string): Promise<LiveConfig | undefined> {
    const config = await this.observer.loading(() => this.eslint.calculateConfigForFile(abs));
    const file = await this.eslint.findConfigFile(abs).catch(() => undefined);
    if (file !== undefined && !this.configs.has(file)) {
      if (!this.observer.saw(file)) {
        const name = projectPath(file, this.root) ?? file;
        throw new Unobserved(`the ESLint worker cannot see which files ${name} loads`);
      }
      this.configs.add(file);
    }
    return config;
  }

  private async typedTsconfigs(ts: NonNullable<ReturnType<typeof loadedTypeScript>>) {
    const found = new Set<AbsolutePath>();
    for (const tsconfig of findTsconfigs(this.root)) {
      for (const file of parseTsconfig(ts, tsconfig)?.files ?? []) {
        const path = projectPath(file, this.root);
        const config = path === null ? undefined : await this.configOf(path);
        if (typeof config !== "object" || !typed(config)) continue;
        this.feeder ??= config;
        const options = config.languageOptions?.parserOptions ?? {};
        const named = typeof options.project === "string" || Array.isArray(options.project);
        for (const one of named ? namedTsconfigs(options, this.root) : [tsconfig]) found.add(one);
        break;
      }
    }
    return [...found].sort();
  }

  private parse(file: LintFile, config: LiveConfig): TsProgramLike | undefined {
    const options = config.languageOptions;
    try {
      return options?.parser?.parseForESLint?.(file.text, {
        ...options.parserOptions,
        ecmaVersion: options.ecmaVersion,
        sourceType: options.sourceType,
        filePath: join(this.root, file.path),
      }).services?.program;
    } catch {
      return undefined;
    }
  }

  private learn(program: TsProgramLike | undefined): void {
    if (program === undefined) return;
    for (const source of program.getSourceFiles()) {
      const rel = this.keyPath(source.fileName);
      if (rel !== null) this.learned.files.add(rel);
    }
    const options = program.getCompilerOptions();
    const configs = [options.configFilePath, ...(options.configFile?.extendedSourceFiles ?? [])];
    for (const config of configs) {
      const rel = typeof config === "string" ? this.keyPath(config) : null;
      if (rel !== null) this.learned.tsconfigs.add(rel);
    }
  }

  /** A path as keys hold it, `../` above the root (wave 1.7 Q2). */
  private keyPath(path: AbsolutePath): RelativePath | null {
    return keyPath(path, [this.root, this.given]);
  }

  private inProgram(path: RelativePath): boolean {
    return this.program.files.includes(path) || this.learned.files.has(path);
  }

  /** The config's JSON with the project root written `<root>` (goal 7). */
  private rootless(json: string): string {
    let out = json;
    for (const root of new Set([this.root, this.given])) {
      out = out.split(JSON.stringify(root + sep).slice(1, -1)).join(`${ROOT_TOKEN}/`);
      out = out.split(JSON.stringify(root).slice(1, -1)).join(ROOT_TOKEN);
    }
    return out;
  }
}

function typed(config: LiveConfig): boolean {
  return lintSignals({
    languageOptions: { parserOptions: config.languageOptions?.parserOptions ?? {} },
  }).typed;
}

function noConfig(error: unknown): boolean {
  const template = (error as { messageTemplate?: unknown } | null)?.messageTemplate;
  return (
    template === "config-file-missing" || firstLine(error).startsWith("Could not find config file")
  );
}

function message(m: RawMessage): EslintMessage {
  return {
    ruleId: m.ruleId,
    severity: m.severity,
    message: m.message,
    ...(m.line === undefined ? {} : { line: m.line }),
    ...(m.column === undefined ? {} : { column: m.column }),
  };
}

function union(...sets: Iterable<string>[]): string[] {
  return [...new Set(sets.flatMap((s) => [...s]))].sort();
}
