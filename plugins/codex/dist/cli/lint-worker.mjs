import { createRequire as __squealCreateRequire } from "node:module";
const require = __squealCreateRequire(import.meta.url);

// src/core/lint/provider/worker.ts
import { parentPort, workerData } from "node:worker_threads";

// src/core/lint/provider/observe.ts
import fs from "node:fs";
import { registerHooks } from "node:module";
import { isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
var Observer = class _Observer {
  /** Resolved module URLs and the file URLs of reads, for `sortLoaded`. */
  urls = /* @__PURE__ */ new Set();
  files = /* @__PURE__ */ new Set();
  loads = 0;
  /** Sets the hook and the recorder in this thread; call once, before ESLint loads. */
  static install() {
    const observer2 = new _Observer();
    registerHooks({
      resolve(specifier, context, nextResolve) {
        const result = nextResolve(specifier, context);
        observer2.module(result.url);
        return result;
      }
    });
    process.env.JITI_FS_CACHE = "false";
    const { readFileSync: readFileSync3 } = fs;
    fs.readFileSync = function(path, ...rest) {
      observer2.read(path);
      return Reflect.apply(readFileSync3, this, [path, ...rest]);
    };
    return observer2;
  }
  /** Runs `work`, a config load, with each file it reads recorded. */
  async loading(work) {
    this.loads++;
    try {
      return await work();
    } finally {
      this.loads--;
    }
  }
  /** Whether the thread resolved or, loading a config, read `path`. */
  saw(path) {
    return this.files.has(path);
  }
  module(url) {
    this.urls.add(url);
    if (url.startsWith("file:")) this.files.add(fileURLToPath(url.split("?")[0] ?? url));
  }
  read(path) {
    if (this.loads === 0) return;
    const file = path instanceof URL && path.protocol === "file:" ? fileURLToPath(path) : path;
    if (typeof file !== "string" || !isAbsolute(file)) return;
    this.files.add(file);
    this.urls.add(pathToFileURL(file).href);
  }
};

// src/core/lint/provider/protocol.ts
var PROVIDER_VERSION = 2;
var ROOT_TOKEN = "<root>";
function firstLine(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.split("\n")[0]?.trim() ?? "";
}

// src/core/lint/provider/session.ts
import { readFileSync as readFileSync2, realpathSync as realpathSync2 } from "node:fs";
import { createRequire as createRequire2 } from "node:module";
import { join as join2, sep as sep3 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";

// src/core/lint/provider/loaded.ts
import { isAbsolute as isAbsolute2, relative, sep } from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var NODE_MODULES = `${sep}node_modules${sep}`;
function sortLoaded(urls, root2) {
  const closure = /* @__PURE__ */ new Set();
  const packages = /* @__PURE__ */ new Set();
  for (const url of urls) {
    if (!url.startsWith("file:")) continue;
    const path = fileURLToPath2(url.split("?")[0] ?? url);
    const pkg = packageRoot(path);
    const inside = projectPath(path, root2);
    if (pkg !== null) packages.add(pkg);
    else if (inside !== null) closure.add(inside);
    else packages.add(path);
  }
  return { closure: [...closure].sort(), packages: [...packages].sort() };
}
function projectPath(path, root2) {
  const rel = relative(root2, path);
  if (rel === "" || rel.startsWith("..") || isAbsolute2(rel)) return null;
  if (`${sep}${rel}${sep}`.includes(NODE_MODULES)) return null;
  return rel.split(sep).join("/");
}
function packageRoot(path) {
  const at = path.lastIndexOf(NODE_MODULES);
  if (at < 0) return null;
  const start = at + NODE_MODULES.length;
  const parts = path.slice(start).split(sep);
  const name = parts[0]?.startsWith("@") ? parts.slice(0, 2) : parts.slice(0, 1);
  return path.slice(0, start) + name.join(sep);
}

// src/core/lint/provider/program.ts
import {
  existsSync,
  globSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync
} from "node:fs";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute as isAbsolute3, join, resolve, sep as sep2 } from "node:path";
function loadedTypeScript(packages) {
  const root2 = packages.find((p) => basename(p) === "typescript");
  if (root2 === void 0) return null;
  return createRequire(join(root2, "package.json"))(root2);
}
function findTsconfigs(root2) {
  const found = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== "node_modules" && !entry.name.startsWith("."))
          walk(join(dir, entry.name));
      } else if (entry.name === "tsconfig.json") found.push(join(dir, entry.name));
    }
  };
  walk(root2);
  return found.sort();
}
function namedTsconfigs(options, root2) {
  const base = typeof options.tsconfigRootDir === "string" ? options.tsconfigRootDir : root2;
  const named = Array.isArray(options.project) ? options.project : [options.project];
  return named.filter((p) => typeof p === "string").flatMap((p) => /[*?[{]/.test(p) ? globSync(p, { cwd: base }) : [p]).map((p) => isAbsolute3(p) ? p : resolve(base, p)).sort();
}
function parseTsconfig(ts, path) {
  try {
    const host = { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {
    } };
    const parsed = ts.getParsedCommandLineOfConfigFile(path, {}, host);
    if (parsed === void 0) return null;
    return {
      files: parsed.fileNames,
      extended: parsed.options.configFile?.extendedSourceFiles ?? [],
      options: parsed.options,
      ...parsed.wildcardDirectories ? { wildcardDirectories: parsed.wildcardDirectories } : {}
    };
  } catch {
    return null;
  }
}
var NODE_MODULES2 = `${sep2}node_modules${sep2}`;
var JAVASCRIPT = /\.[cm]?jsx?$/;
var JSDOC_IMPORT = /@import\s[^"'@]*?\bfrom\s*["']([^"'\n]+)["']|\bimport\(\s*["']([^"'\n]+)["']\s*\)/g;
var RECURSIVE = 1;
var ProgramReader = class {
  constructor(ts, root2, now = Date.now) {
    this.ts = ts;
    this.root = root2;
    this.now = now;
    this.watch = new Watch(now);
  }
  ts;
  root;
  now;
  specifiers = /* @__PURE__ */ new Map();
  /** By tsconfig, then file: two tsconfigs may resolve one file's names apart. */
  resolved = /* @__PURE__ */ new Map();
  parsed = /* @__PURE__ */ new Map();
  watch;
  paths = /* @__PURE__ */ new Map();
  /** The program of `tsconfigs`, as project paths. */
  read(tsconfigs) {
    this.watch.restat();
    const configs = /* @__PURE__ */ new Set();
    const files = /* @__PURE__ */ new Set();
    for (const tsconfig of tsconfigs) {
      const parsed = this.parse(tsconfig);
      for (const path of [tsconfig, ...parsed?.extended ?? []]) {
        const rel = this.projectPath(path);
        if (rel !== null) configs.add(rel);
      }
      if (parsed === null) continue;
      for (const file of this.walk(tsconfig, parsed)) {
        const rel = this.projectPath(file);
        if (rel !== null) files.add(rel);
      }
    }
    return { tsconfigs: [...configs].sort(), files: [...files].sort() };
  }
  projectPath(path) {
    let rel = this.paths.get(path);
    if (rel === void 0) {
      rel = projectPath(path, this.root);
      this.paths.set(path, rel);
    }
    return rel;
  }
  parse(tsconfig) {
    const kept = this.parsed.get(tsconfig);
    if (kept !== void 0 && this.watch.holds(tsconfig)) return kept.parsed;
    const parsed = parseTsconfig(this.ts, tsconfig);
    const read = [tsconfig, ...parsed?.extended ?? [], ...globFolders(parsed)];
    this.watch.made(tsconfig, read, kept?.read);
    this.parsed.set(tsconfig, { parsed, read });
    return parsed;
  }
  /**
   * The root files and every file their imports, reference directives and
   * automatic types resolve to, followed outside `node_modules`: a
   * package's own imports are the install's (D5's packages).
   */
  walk(tsconfig, parsed) {
    const { ts } = this;
    const { options } = parsed;
    let cache = null;
    const resolver = {
      module: (name, file, mode) => {
        cache ??= ts.createModuleResolutionCache(dirname(tsconfig), (n) => n, options);
        const result = ts.resolveModuleName(name, file, options, ts.sys, cache, void 0, mode);
        return [result.resolvedModule?.resolvedFileName, result];
      },
      type: (name, file) => {
        const result = ts.resolveTypeReferenceDirective(name, file, options, ts.sys);
        return [result.resolvedTypeReferenceDirective?.resolvedFileName, result];
      },
      modes: this.modes(options)
    };
    const seen = new Set(parsed.files);
    const queue2 = [...parsed.files];
    const follow = (file) => {
      if (file === void 0 || seen.has(file) || file.includes(NODE_MODULES2)) return;
      seen.add(file);
      queue2.push(file);
    };
    const inferred = join(dirname(tsconfig), "__inferred type names__.ts");
    for (const name of ts.getAutomaticTypeDirectiveNames(options, ts.sys)) {
      follow(resolver.type(name, inferred)[0]);
    }
    const resolved = this.resolved.get(tsconfig) ?? /* @__PURE__ */ new Map();
    this.resolved.set(tsconfig, resolved);
    for (let file = queue2.pop(); file !== void 0; file = queue2.pop()) {
      for (const target of this.targetsOf(tsconfig, file, resolver, resolved)) follow(target);
    }
    return seen;
  }
  /** Where `file`'s specifiers resolve: kept, unless its bytes or what its lookups read changed. */
  targetsOf(tsconfig, file, resolver, kept) {
    const specifiers = this.specifiersOf(file);
    if (specifiers === null) return [];
    const before = kept.get(file);
    const key = `${tsconfig}\0${file}`;
    if (before?.stamp === specifiers.stamp && !before.unsure && this.watch.holds(key)) {
      return before.targets;
    }
    const targets = [];
    const watched = /* @__PURE__ */ new Set();
    let unsure = false;
    const found = ([target, lookups]) => {
      const failed = lookups.failedLookupLocations;
      if (target === void 0 && failed === void 0) unsure = true;
      for (const path of [...failed ?? [], ...target ? [target] : []]) {
        if (!path.includes(NODE_MODULES2)) watched.add(dirname(path));
      }
      for (const path of lookups.affectingLocations ?? []) {
        if (!path.includes(NODE_MODULES2)) watched.add(path);
      }
      if (target !== void 0) targets.push(target);
    };
    for (const name of specifiers.modules) {
      for (const mode of resolver.modes) found(resolver.module(name, file, mode));
    }
    for (const name of specifiers.types) found(resolver.type(name, file));
    for (const path of specifiers.paths) {
      const target = referenced(resolve(dirname(file), path));
      watched.add(dirname(resolve(dirname(file), path)));
      if (target !== void 0) targets.push(target);
    }
    this.watch.made(key, watched, before?.read);
    kept.set(file, { stamp: specifiers.stamp, targets, read: [...watched], unsure });
    return targets;
  }
  /**
   * Both import modes where the resolution kind reads them (Node16,
   * NodeNext, Bundler): the walk does not tell an `import` from a
   * `require`, so it takes the files either resolves to.
   */
  modes(options) {
    const { ModuleKind, ModuleResolutionKind } = this.ts;
    const kind = this.ts.getEmitModuleResolutionKind?.(options);
    return kind === ModuleResolutionKind.Classic || kind === ModuleResolutionKind.Node10 ? [void 0] : [ModuleKind.ESNext, ModuleKind.CommonJS];
  }
  /** `file`'s specifiers, read again when its stat changed; `null` when it cannot be read. */
  specifiersOf(file) {
    const stamp = stateOf(file, this.now);
    const kept = this.specifiers.get(file);
    if (kept?.stamp === stamp) return kept;
    let text;
    try {
      text = readFileSync(file, "utf8");
    } catch {
      this.specifiers.delete(file);
      return null;
    }
    const javascript = JAVASCRIPT.test(file);
    const info = this.ts.preProcessFile(text, true, javascript);
    const modules = info.importedFiles.map((f) => f.fileName);
    if (javascript) {
      for (const match of text.matchAll(JSDOC_IMPORT)) modules.push(match[1] ?? match[2] ?? "");
    }
    const specifiers = {
      stamp,
      modules: [...new Set(modules)],
      paths: info.referencedFiles.map((f) => f.fileName),
      types: info.typeReferenceDirectives.map((f) => f.fileName)
    };
    this.specifiers.set(file, specifiers);
    return specifiers;
  }
};
var Watch = class {
  constructor(now) {
    this.now = now;
  }
  now;
  states = /* @__PURE__ */ new Map();
  /** A folder's entries, for the folders among `states`. */
  entries = /* @__PURE__ */ new Map();
  readers = /* @__PURE__ */ new Map();
  stale = /* @__PURE__ */ new Set();
  /** Reads every watched path's state again; a change makes its results stale. */
  restat() {
    for (const [path, state] of this.states) {
      const now = stateOf(path, this.now);
      if (now === state) continue;
      this.states.set(path, now);
      const entries = entriesOf(path);
      if (entries !== null && entries === this.entries.get(path)) continue;
      this.record(path, entries);
      for (const result of this.readers.get(path) ?? []) this.stale.add(result);
    }
  }
  /** `result` was made now from `paths`, in place of one made from `before`. */
  made(result, paths, before = []) {
    for (const path of before) this.readers.get(path)?.delete(result);
    this.stale.delete(result);
    for (const path of paths) {
      if (!this.states.has(path)) {
        this.states.set(path, stateOf(path, this.now));
        this.record(path, entriesOf(path));
      }
      const readers = this.readers.get(path) ?? /* @__PURE__ */ new Set();
      readers.add(result);
      this.readers.set(path, readers);
    }
  }
  record(path, entries) {
    if (entries === null) this.entries.delete(path);
    else this.entries.set(path, entries);
  }
  /** Whether `result` holds: no path it read changed state since it was made. */
  holds(result) {
    return !this.stale.has(result);
  }
};
var RACY_MS = 1e3;
var racy = 0;
function stateOf(path, now) {
  const stat = statSync(path, { throwIfNoEntry: false });
  if (stat === void 0) return "missing";
  if (now() - Math.max(stat.mtimeMs, stat.ctimeMs) < RACY_MS) return `racy ${++racy}`;
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}:${stat.ino}`;
}
function entriesOf(path) {
  let entries;
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return null;
  }
  return entries.map((e) => {
    if (e.isSymbolicLink()) return `l ${e.name} ${linkOf(join(path, e.name))}`;
    return `${e.isDirectory() ? "d" : "f"} ${e.name}`;
  }).sort().join("\n");
}
function linkOf(path) {
  try {
    return readlinkSync(path);
  } catch {
    return "";
  }
}
function globFolders(parsed) {
  const out = [];
  const links = /* @__PURE__ */ new Set();
  const visit = (dir, recursive) => {
    out.push(dir);
    if (!recursive) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path, true);
      else if (entry.isSymbolicLink() && statSync(path, { throwIfNoEntry: false })?.isDirectory()) {
        const real = realpathSync(path);
        if (links.has(real)) continue;
        links.add(real);
        visit(path, true);
      }
    }
  };
  for (const [dir, flags] of Object.entries(parsed?.wildcardDirectories ?? {})) {
    visit(dir, (flags & RECURSIVE) !== 0);
  }
  return out;
}
function referenced(path) {
  return [path, `${path}.ts`, `${path}.tsx`, `${path}.d.ts`].find((p) => existsSync(p));
}

// src/core/lint/provider/signals.ts
var CROSS_FILE_PLUGINS = /* @__PURE__ */ new Set([
  "eslint-plugin-import",
  "eslint-plugin-import-x"
]);
var CROSS_FILE_NAMESPACES = /* @__PURE__ */ new Set(["import", "import-x"]);
function lintSignals(config) {
  const options = config.languageOptions?.parserOptions ?? {};
  const typed2 = Boolean(options.project || options.projectService || options.programs);
  const crossSpaces = new Set(CROSS_FILE_NAMESPACES);
  for (const entry of config.plugins ?? []) {
    const colon = entry.indexOf(":");
    if (colon < 0) continue;
    const named = entry.slice(colon + 1);
    const at = named.lastIndexOf("@");
    if (CROSS_FILE_PLUGINS.has(at > 0 ? named.slice(0, at) : named)) {
      crossSpaces.add(entry.slice(0, colon));
    }
  }
  const crossFile = Object.entries(config.rules ?? {}).some(([id, setting]) => {
    const slash = id.lastIndexOf("/");
    return slash > 0 && crossSpaces.has(id.slice(0, slash)) && enabled(setting);
  });
  return { typed: typed2, crossFile };
}
function enabled(setting) {
  const severity = Array.isArray(setting) ? setting[0] : setting;
  return severity !== 0 && severity !== "off" && severity !== void 0;
}

// src/core/lint/provider/session.ts
var KEYED_ENV = ["ESLINT_USE_FLAT_CONFIG", "TSESTREE_SINGLE_RUN"];
var PROBE = "squeal-config-probe.js";
var ConfigError = class extends Error {
};
var Unobserved = class extends Error {
};
var EslintSession = class _EslintSession {
  constructor(given, root2, version, ESLint, observer2) {
    this.given = given;
    this.root = root2;
    this.version = version;
    this.ESLint = ESLint;
    this.observer = observer2;
    this.eslint = new ESLint({ cwd: root2 });
  }
  given;
  root;
  version;
  ESLint;
  observer;
  eslint;
  /** The tsconfigs typed configs read; found once per instance. */
  relevant = null;
  program = { tsconfigs: [], files: [] };
  reader = null;
  /** Program files and tsconfigs learned from a lint, kept for the thread's life. */
  learned = { tsconfigs: /* @__PURE__ */ new Set(), files: /* @__PURE__ */ new Set() };
  /** A typed config, to feed a program file ESLint does not lint. */
  feeder = null;
  /** Each config file ESLint used, its load seen: in the closure for the thread's life. */
  configs = /* @__PURE__ */ new Set();
  /** D3 discovery; `off` with D9's reason. */
  static async open(given, observer2) {
    const root2 = realpathSync2(given);
    const require2 = createRequire2(join2(root2, "package.json"));
    let manifest;
    try {
      manifest = require2.resolve("eslint/package.json");
    } catch {
      return { off: `no ESLint installed in ${given}` };
    }
    const version = String(JSON.parse(readFileSync2(manifest, "utf8")).version);
    const major = Number.parseInt(version, 10);
    if (major !== 9 && major !== 10) return { off: `ESLint ${major} is not supported` };
    const api = await import(pathToFileURL2(require2.resolve("eslint")).href);
    const ESLint = api.loadESLint ? await api.loadESLint({ cwd: root2 }) : api.ESLint;
    if (ESLint.configType !== void 0 && ESLint.configType !== "flat") {
      return { off: "eslintrc configs are not supported; ESLint 9 and 10 read eslint.config.*" };
    }
    return new _EslintSession(given, root2, version, ESLint, observer2);
  }
  async declaration() {
    const config = await this.eslint.findConfigFile().catch(() => void 0);
    const rel = config === void 0 ? null : projectPath(config, this.root);
    return {
      tool: "eslint",
      toolVersion: this.version,
      providerVersion: PROVIDER_VERSION,
      configFiles: rel === null ? [] : [rel]
    };
  }
  /** D4 `instance`: a new `ESLint`, which imports the config again. */
  fresh() {
    this.eslint = new this.ESLint({ cwd: this.root });
    this.relevant = null;
    this.feeder = null;
  }
  /**
   * Loads the config and reads the program again; a config that does not
   * load is told by `inputs` and `lint`. Throws `Unobserved`.
   */
  async refreshed() {
    await this.computed(join2(this.root, PROBE)).catch((error) => {
      if (error instanceof Unobserved) throw error;
    });
    const ts = loadedTypeScript(sortLoaded(this.observer.urls, this.root).packages);
    if (ts !== null) {
      this.relevant ??= await this.typedTsconfigs(ts);
      if (this.reader?.ts !== ts) this.reader = new ProgramReader(ts, this.root);
      this.program = this.reader.read(this.relevant);
    }
    return this.environment();
  }
  environment() {
    const sets = sortLoaded(this.observer.urls, this.root);
    const env = {};
    for (const name of KEYED_ENV) {
      const value = process.env[name];
      if (value !== void 0) env[name] = value;
    }
    const configs = [...this.configs].flatMap((file) => projectPath(file, this.root) ?? []);
    return {
      closure: union(sets.closure, configs, this.program.tsconfigs, this.learned.tsconfigs),
      packages: sets.packages,
      program: union(this.program.files, this.learned.files),
      env
    };
  }
  async inputs(paths, progress) {
    const out = [];
    for (const path of paths) {
      const config = await this.configOf(path);
      progress();
      if (typeof config === "string") throw new ConfigError(config);
      if (config === void 0) continue;
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
  async lint(files, progress) {
    const results = [];
    const told = (path, result) => results.push([path, result]);
    const linted = [];
    const feed = [];
    for (const file of files) {
      const config = await this.configOf(file.path);
      if (typeof config === "string") told(file.path, { unknown: config });
      else if (config !== void 0) {
        linted.push(file);
        if (typed(config)) {
          this.feeder ??= config;
          feed.push({ file, config, lints: true });
        }
      } else if (this.inProgram(file.path) && this.feeder !== null) {
        feed.push({ file, config: this.feeder, lints: false });
      } else told(file.path, { unknown: "ESLint does not lint this file" });
    }
    const alone = feed.length === 1 && feed[0]?.lints === true;
    const feeding = !alone ? feed : feed.filter(({ file }) => !this.inProgram(file.path));
    for (const { file, config } of feeding) {
      this.learn(this.parse(file, config));
      progress();
    }
    for (const file of linted) {
      told(file.path, await this.lintOne(file));
      progress();
    }
    return results;
  }
  async lintOne(file) {
    let results;
    try {
      results = await this.eslint.lintText(file.text, {
        filePath: join2(this.root, file.path),
        warnIgnored: false
      });
    } catch (error) {
      return { unknown: `ESLint failed on this file: ${firstLine(error)}` };
    }
    const result = results[0];
    if (result === void 0) return { unknown: "ESLint does not lint this file" };
    return { messages: result.messages.map(message) };
  }
  /**
   * The file's computed config; `undefined` when ESLint does not lint it;
   * D9's reason when the config does not load. Throws `Unobserved`.
   */
  async configOf(path) {
    const abs = join2(this.root, path);
    try {
      return await this.computed(abs);
    } catch (error) {
      if (error instanceof Unobserved) throw error;
      if (noConfig(error)) return void 0;
      const config = await this.eslint.findConfigFile(abs).catch(() => void 0);
      const name = (config && projectPath(config, this.root)) ?? "eslint.config.js";
      return `${name} does not load: ${firstLine(error)}`;
    }
  }
  /**
   * `calculateConfigForFile` with its config's load observed (D4). The
   * config file joins the closure, as ESLint's own name for it: one whose
   * load the worker did not see throws `Unobserved`.
   */
  async computed(abs) {
    const config = await this.observer.loading(() => this.eslint.calculateConfigForFile(abs));
    const file = await this.eslint.findConfigFile(abs).catch(() => void 0);
    if (file !== void 0 && !this.configs.has(file)) {
      if (!this.observer.saw(file)) {
        const name = projectPath(file, this.root) ?? file;
        throw new Unobserved(`the ESLint worker cannot see which files ${name} loads`);
      }
      this.configs.add(file);
    }
    return config;
  }
  async typedTsconfigs(ts) {
    const found = /* @__PURE__ */ new Set();
    for (const tsconfig of findTsconfigs(this.root)) {
      for (const file of parseTsconfig(ts, tsconfig)?.files ?? []) {
        const path = projectPath(file, this.root);
        const config = path === null ? void 0 : await this.configOf(path);
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
  parse(file, config) {
    const options = config.languageOptions;
    try {
      return options?.parser?.parseForESLint?.(file.text, {
        ...options.parserOptions,
        ecmaVersion: options.ecmaVersion,
        sourceType: options.sourceType,
        filePath: join2(this.root, file.path)
      }).services?.program;
    } catch {
      return void 0;
    }
  }
  learn(program) {
    if (program === void 0) return;
    for (const source of program.getSourceFiles()) {
      const rel = projectPath(source.fileName, this.root);
      if (rel !== null) this.learned.files.add(rel);
    }
    const options = program.getCompilerOptions();
    const configs = [options.configFilePath, ...options.configFile?.extendedSourceFiles ?? []];
    for (const config of configs) {
      const rel = typeof config === "string" ? projectPath(config, this.root) : null;
      if (rel !== null) this.learned.tsconfigs.add(rel);
    }
  }
  inProgram(path) {
    return this.program.files.includes(path) || this.learned.files.has(path);
  }
  /** The config's JSON with the project root written `<root>` (goal 7). */
  rootless(json) {
    let out = json;
    for (const root2 of /* @__PURE__ */ new Set([this.root, this.given])) {
      out = out.split(JSON.stringify(root2 + sep3).slice(1, -1)).join(`${ROOT_TOKEN}/`);
      out = out.split(JSON.stringify(root2).slice(1, -1)).join(ROOT_TOKEN);
    }
    return out;
  }
};
function typed(config) {
  return lintSignals({
    languageOptions: { parserOptions: config.languageOptions?.parserOptions ?? {} }
  }).typed;
}
function noConfig(error) {
  const template = error?.messageTemplate;
  return template === "config-file-missing" || firstLine(error).startsWith("Could not find config file");
}
function message(m) {
  return {
    ruleId: m.ruleId,
    severity: m.severity,
    message: m.message,
    ...m.line === void 0 ? {} : { line: m.line },
    ...m.column === void 0 ? {} : { column: m.column }
  };
}
function union(...sets) {
  return [...new Set(sets.flatMap((s) => [...s]))].sort();
}

// src/core/lint/provider/worker.ts
var observer = Observer.install();
var port = parentPort;
var { root } = workerData;
var session = null;
var queue = Promise.resolve();
var send = (message2) => port?.postMessage(message2);
port?.on("message", (message2) => {
  queue = queue.then(() => handle(message2));
});
async function handle(message2) {
  try {
    const answer = await answerOf(message2);
    await new Promise((resolve2) => setTimeout(resolve2, 0));
    send({ type: "done", id: message2.id, answer });
  } catch (error) {
    send({ type: "error", id: message2.id, message: firstLine(error) });
  }
}
async function answerOf(message2) {
  try {
    return await answered(message2);
  } catch (error) {
    if (error instanceof Unobserved) return { type: "off", reason: error.message };
    throw error;
  }
}
async function answered(message2) {
  const progress = () => send({ type: "progress", id: message2.id });
  if (message2.type === "open") {
    const opened = await EslintSession.open(root, observer);
    if ("off" in opened) return { type: "off", reason: opened.off };
    session = opened;
    return { type: "open", declaration: await opened.declaration() };
  }
  if (session === null) throw new Error("the ESLint worker was not opened");
  if (message2.type === "refresh") {
    if (message2.fresh) session.fresh();
    const env = await session.refreshed();
    return { type: "snapshot", declaration: await session.declaration(), env };
  }
  if (message2.type === "inputs") {
    return { type: "inputs", inputs: await session.inputs(message2.paths, progress) };
  }
  const results = await session.lint(message2.files, progress);
  return { type: "linted", results, env: session.environment() };
}
