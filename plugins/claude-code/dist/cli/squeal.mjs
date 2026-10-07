#!/usr/bin/env node
var __defProp = Object.defineProperty;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res, err) => function __init() {
  if (err) throw err[0];
  try {
    return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
  } catch (e) {
    throw err = [e], e;
  }
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// src/core/keys/check-key.ts
import { createHash } from "node:crypto";
function encodeSegment(path, hash) {
  return Buffer.from(`${path}\0${hash ?? MISSING}\0`).toString();
}
function keyFromSegments(envHash, testFile, segments) {
  return createHash("sha256").update(JSON.stringify([KEY_ENCODING, envHash, testFile.project, testFile.path])).update("\0").update(segments.join("")).digest("hex");
}
var KEY_ENCODING, MISSING;
var init_check_key = __esm({
  "src/core/keys/check-key.ts"() {
    "use strict";
    KEY_ENCODING = "squeal-check-key/1";
    MISSING = "-";
  }
});

// src/core/fs/compare.ts
function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
var init_compare = __esm({
  "src/core/fs/compare.ts"() {
    "use strict";
  }
});

// src/core/fs/errors.ts
function isMissing(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
var init_errors = __esm({
  "src/core/fs/errors.ts"() {
    "use strict";
  }
});

// src/core/fs/git.ts
import { spawn } from "node:child_process";
function runGit(cwd, args, options = {}) {
  const okCodes = options.okCodes ?? [0];
  const env = { ...process.env, GIT_OPTIONAL_LOCKS: "0" };
  for (const name of REPOSITORY_VARIABLES) delete env[name];
  return new Promise((resolve7, reject) => {
    const child = spawn("git", args, { cwd, env, stdio: ["pipe", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", (error) => {
      reject(new Error(`squeal: git ${args.join(" ")} failed in ${cwd}: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== null && okCodes.includes(code)) {
        resolve7(Buffer.concat(stdout).toString("utf8"));
        return;
      }
      const message2 = Buffer.concat(stderr).toString("utf8").trim();
      reject(new Error(`squeal: git ${args.join(" ")} exited ${code} in ${cwd}: ${message2}`));
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(options.input ?? "");
  });
}
function splitNul(output) {
  const fields = output.split("\0");
  if (fields.at(-1) === "") fields.pop();
  return fields;
}
var REPOSITORY_VARIABLES;
var init_git = __esm({
  "src/core/fs/git.ts"() {
    "use strict";
    REPOSITORY_VARIABLES = [
      "GIT_DIR",
      "GIT_WORK_TREE",
      "GIT_INDEX_FILE",
      "GIT_COMMON_DIR",
      "GIT_OBJECT_DIRECTORY"
    ];
  }
});

// src/core/fs/git-layout.ts
import { createHash as createHash2 } from "node:crypto";
import { existsSync, lstatSync, readFileSync as readFileSync2, realpathSync } from "node:fs";
import { lstat } from "node:fs/promises";
import { dirname as dirname2, isAbsolute, join as join2, resolve } from "node:path";
function findWorktreeRoot(path) {
  let dir = resolve(path);
  if (existsSync(dir)) dir = realpathSync(dir);
  for (; ; ) {
    if (existsSync(join2(dir, ".git"))) return dir;
    const parent = dirname2(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
async function hasGitEntry(dir) {
  try {
    await lstat(join2(dir, ".git"));
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
function worktreeIdFor(root) {
  return createHash2("sha256").update(realpathSync(root)).digest("hex").slice(0, 16);
}
function gitDirOf(root) {
  return dotGit(root)?.gitDir ?? null;
}
function linkedWorktreeDir(root) {
  const entry2 = dotGit(root);
  return entry2?.isFile ? entry2.gitDir : null;
}
function resolveCommonDir(root) {
  const entry2 = dotGit(root);
  if (entry2 === null) return null;
  if (!entry2.isFile) return realpathSync(entry2.gitDir);
  const { gitDir } = entry2;
  if (lstatOrNull(gitDir) === null) return null;
  const commondirFile = join2(gitDir, "commondir");
  if (lstatOrNull(commondirFile) === null) return realpathSync(gitDir);
  const commondir = readFileSync2(commondirFile, "utf8").trim();
  const common = isAbsolute(commondir) ? commondir : resolve(gitDir, commondir);
  return lstatOrNull(common) === null ? null : realpathSync(common);
}
function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
function dotGit(root) {
  const path = join2(root, ".git");
  const stat5 = lstatOrNull(path);
  if (stat5 === null) return null;
  if (stat5.isDirectory()) return { gitDir: path, isFile: false };
  if (!stat5.isFile()) return null;
  const match = GITDIR_LINE.exec(readFileSync2(path, "utf8"));
  return match?.[1] ? { gitDir: resolve(root, match[1]), isFile: true } : null;
}
var GITDIR_LINE;
var init_git_layout = __esm({
  "src/core/fs/git-layout.ts"() {
    "use strict";
    init_errors();
    GITDIR_LINE = /^gitdir:\s*(.+?)\s*$/m;
  }
});

// src/core/fs/paths.ts
import { isAbsolute as isAbsolute2, join as join3, relative, sep } from "node:path";
function toRelative(root, abs) {
  const rel = relative(root, abs);
  if (rel === "" || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute2(rel)) return null;
  return sep === "/" ? rel : rel.split(sep).join("/");
}
function toAbsolute(root, rel) {
  return join3(root, ...rel.split("/"));
}
var init_paths = __esm({
  "src/core/fs/paths.ts"() {
    "use strict";
  }
});

// src/core/fs/index.ts
var init_fs = __esm({
  "src/core/fs/index.ts"() {
    "use strict";
    init_compare();
    init_errors();
    init_git();
    init_git_layout();
    init_paths();
  }
});

// src/core/keys/glob.ts
function globToRegExp(glob) {
  if (glob.startsWith("!")) throw new Error(`squeal: negated input glob is not supported: ${glob}`);
  if (glob.startsWith("/")) throw new Error(`squeal: input glob must be relative: ${glob}`);
  const source = glob.startsWith("./") ? glob.slice(2) : glob;
  return new RegExp(`^${compile(source, glob)}$`, "s");
}
function createInputMatcher(globs) {
  if (globs.length === 0) return () => false;
  const patterns = globs.map(globToRegExp);
  return (path) => patterns.some((pattern) => pattern.test(path));
}
function compile(glob, original) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const char = glob[i];
    if (char === "*") {
      if (glob[i + 1] === "*") {
        const atStart = i === 0 || glob[i - 1] === "/";
        const atEnd = i + 2 === glob.length || glob[i + 2] === "/";
        if (atStart && atEnd) {
          if (i + 2 === glob.length) out += ".+";
          else out += "(?:.+/)?";
          i += 3;
          continue;
        }
      }
      out += "[^/]*";
      i += glob[i + 1] === "*" ? 2 : 1;
    } else if (char === "?") {
      out += "[^/]";
      i++;
    } else if (char === "[") {
      const end = glob.indexOf("]", i + 2);
      if (end === -1) throw new Error(`squeal: unclosed [ in input glob: ${original}`);
      let body = glob.slice(i + 1, end);
      const negated = body.startsWith("!");
      if (negated) body = body.slice(1);
      out += `[${negated ? "^/" : ""}${body.replace(/[\\\]]/g, "\\$&")}]`;
      i = end + 1;
    } else if (char === "{") {
      const end = matchingBrace(glob, i, original);
      const alternatives = splitTopLevel(glob.slice(i + 1, end));
      out += `(?:${alternatives.map((alt) => compile(alt, original)).join("|")})`;
      i = end + 1;
    } else {
      out += char.replace(/[.+^$()|\\{}\]]/, "\\$&");
      i++;
    }
  }
  return out;
}
function matchingBrace(glob, open3, original) {
  let depth = 0;
  for (let i = open3; i < glob.length; i++) {
    if (glob[i] === "{") depth++;
    else if (glob[i] === "}" && --depth === 0) return i;
  }
  throw new Error(`squeal: unclosed { in input glob: ${original}`);
}
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    if (body[i] === "{") depth++;
    else if (body[i] === "}") depth--;
    else if (body[i] === "," && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  return parts;
}
var init_glob = __esm({
  "src/core/keys/glob.ts"() {
    "use strict";
  }
});

// src/core/keys/closure.ts
import { posix } from "node:path";
function normalizeRelativePath(path) {
  if (ALREADY_NORMAL.test(path)) return path;
  const slashed = path.replaceAll("\\", "/");
  if (slashed === "" || slashed.startsWith("/") || /^[A-Za-z]:\//.test(slashed)) {
    throw new Error(`squeal: expected a worktree-relative path, got "${path}"`);
  }
  const normalized = posix.normalize(slashed).replace(/\/$/, "");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../")) {
    throw new Error(`squeal: path leaves the worktree: "${path}"`);
  }
  return normalized;
}
function createDeclaredInputs(inputs2, files) {
  const known2 = [...files];
  const select = (globs) => {
    const matches = createInputMatcher(globs);
    return known2.filter((file) => matches(file)).sort(compare);
  };
  if (isInputList(inputs2)) {
    const selected = select(inputs2);
    return { for: () => selected, all: selected };
  }
  const rules = Object.entries(inputs2).map(([testGlob, globs]) => ({
    applies: createInputMatcher([testGlob]),
    selected: select(globs)
  }));
  const union = (lists) => lists.length === 1 ? lists[0] : [...new Set(lists.flat())].sort(compare);
  return {
    for: (testFile) => union(rules.filter((r) => r.applies(testFile)).map((r) => r.selected)),
    all: union(rules.map((r) => r.selected))
  };
}
function unmatchedInputs(inputs2, testFiles, files) {
  const known2 = [...files];
  const matchesNone = (glob, paths) => {
    const matches = createInputMatcher([glob]);
    return !paths.some((path) => matches(path));
  };
  const tests = [...testFiles];
  const testGlobs = isInputList(inputs2) ? [] : Object.keys(inputs2).filter((glob) => matchesNone(glob, tests));
  return {
    testGlobs: testGlobs.sort(compare),
    inputGlobs: inputGlobs(inputs2).filter((glob) => matchesNone(glob, known2)).sort(compare)
  };
}
function inputGlobs(inputs2) {
  return isInputList(inputs2) ? [...inputs2] : [...new Set(Object.values(inputs2).flat())];
}
function sameInputs(a, b) {
  if (isInputList(a) || isInputList(b)) {
    return isInputList(a) && isInputList(b) && sameList(a, b);
  }
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && sameList(a[key] ?? [], b[key] ?? []));
}
function isInputList(inputs2) {
  return Array.isArray(inputs2);
}
function sameList(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
function assembleClosure(runner, declaredInputs) {
  const paths = /* @__PURE__ */ new Set();
  const include = (path) => {
    let normalized;
    try {
      normalized = normalizeRelativePath(path);
    } catch (error) {
      const { project, path: testPath } = runner.testFile;
      throw new Error(`squeal: closure of ${project}:${testPath}: ${error.message}`);
    }
    if (!isNodeModules(normalized)) paths.add(normalized);
  };
  include(runner.testFile.path);
  for (const path of runner.paths) include(path);
  for (const path of declaredInputs) include(path);
  return {
    testFile: runner.testFile,
    paths: [...paths].sort(compare),
    complete: false,
    method: CLOSURE_METHOD
  };
}
function isNodeModules(path) {
  return path.startsWith("node_modules/") || path.includes("/node_modules/");
}
var CLOSURE_METHOD, ALREADY_NORMAL;
var init_closure = __esm({
  "src/core/keys/closure.ts"() {
    "use strict";
    init_fs();
    init_glob();
    CLOSURE_METHOD = "static imports plus declared inputs";
    ALREADY_NORMAL = /^(?![A-Za-z]:)(?!\.\.?(?:\/|$))[^/\\]+(?:\/(?!\.\.?(?:\/|$))[^/\\]+)*$/;
  }
});

// src/core/keys/environment.ts
import { createHash as createHash3 } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname as dirname3, join as join4, sep as sep2 } from "node:path";
function environmentHash(core, runner, hashOf) {
  const files = [...new Set(runner.files)].sort(compare).map((path) => {
    const hash = hashOf(path);
    if (hash === void 0) {
      throw new Error(
        `squeal: environment of project "${runner.project}": runner file "${path}" has not been hashed`
      );
    }
    return [path, hash];
  });
  const encoded = JSON.stringify([
    ENVIRONMENT_ENCODING,
    core.squealVersion,
    core.nodeVersion,
    core.platform,
    core.arch,
    core.installedDependencies,
    Object.entries(core.env).sort(([a], [b]) => compare(a, b)),
    runner.project,
    runner.runnerName,
    runner.runnerVersion,
    runner.adapterVersion,
    runner.resolvedConfig,
    files
  ]);
  return createHash3("sha256").update(encoded).digest("hex");
}
function coreEnvironmentInputs(options) {
  const source = options.env ?? process.env;
  const env = {};
  for (const name of [...options.allowlist].sort(compare)) {
    const value = source[name];
    if (value !== void 0) env[name] = value;
  }
  return {
    squealVersion: options.squealVersion,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    installedDependencies: options.installedDependencies,
    env
  };
}
async function findInstalledLockfile(projectRoot, worktreeRoot2) {
  const found = await locateLockfile(projectRoot, worktreeRoot2);
  if (found === null) return null;
  const { dir, format } = found;
  return {
    path: join4(dir, format.path),
    patches: format.patches === null ? null : join4(dir, format.patches)
  };
}
async function installedDependenciesFingerprint(projectRoot, worktreeRoot2) {
  const found = await locateLockfile(projectRoot, worktreeRoot2);
  if (found === null) return "none";
  const { dir, format, content } = found;
  const hash = createHash3("sha256").update(`${format.path}\0`).update(content);
  if (format.patches !== null) {
    const patchesDir = join4(dir, format.patches);
    for (const path of await listEntries(patchesDir)) {
      const bytes = await readIfFile(join4(patchesDir, path));
      if (bytes !== null) hash.update(`\0${path}\0${bytes.byteLength}\0`).update(bytes);
    }
  }
  return hash.digest("hex");
}
async function locateLockfile(projectRoot, worktreeRoot2) {
  for (let dir = projectRoot; ; dir = dirname3(dir)) {
    for (const format of LOCKFILES) {
      const content = await readIfFile(join4(dir, format.path));
      if (content !== null) return { dir, format, content };
    }
    if (dirname3(dir) === dir || toRelative(worktreeRoot2, dir) === null) return null;
  }
}
async function readIfFile(path) {
  try {
    if (!(await stat(path)).isFile()) return null;
    return await readFile(path);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function listEntries(dir) {
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.map((entry2) => entry2.split(sep2).join("/")).sort(compare);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}
var ENVIRONMENT_ENCODING, LOCKFILES;
var init_environment = __esm({
  "src/core/keys/environment.ts"() {
    "use strict";
    init_fs();
    ENVIRONMENT_ENCODING = "squeal-environment/1";
    LOCKFILES = [
      { path: "node_modules/.package-lock.json", patches: "patches" },
      { path: "node_modules/.yarn-state.yml", patches: null },
      { path: ".pnp.cjs", patches: ".yarn/patches" },
      { path: ".pnp.js", patches: ".yarn/patches" },
      { path: "node_modules/.yarn-integrity", patches: "patches" },
      { path: "node_modules/.pnpm/lock.yaml", patches: null },
      { path: ".rush/temp/shrinkwrap-deps.json", patches: null },
      { path: "bun.lock", patches: "patches" },
      { path: "bun.lockb", patches: "patches" }
    ];
  }
});

// src/core/keys/reverse-index.ts
import { posix as posix2 } from "node:path";
function testFileId(ref) {
  return `${ref.project}\0${ref.path}`;
}
function directoryOf(path) {
  const dir = posix2.dirname(path);
  return dir === "." ? "" : dir;
}
var ReverseIndex;
var init_reverse_index = __esm({
  "src/core/keys/reverse-index.ts"() {
    "use strict";
    init_fs();
    ReverseIndex = class {
      refs = /* @__PURE__ */ new Map();
      pathsOf = /* @__PURE__ */ new Map();
      byPath = /* @__PURE__ */ new Map();
      byDirectory = /* @__PURE__ */ new Map();
      get size() {
        return this.refs.size;
      }
      /** Replaces the closure paths of `testFile`. */
      set(testFile, paths) {
        const id = testFileId(testFile);
        this.unlink(id);
        this.refs.set(id, testFile);
        this.pathsOf.set(id, paths);
        for (const path of paths) {
          let ids = this.byPath.get(path);
          if (!ids) {
            ids = /* @__PURE__ */ new Set();
            this.byPath.set(path, ids);
            const dir = directoryOf(path);
            let members = this.byDirectory.get(dir);
            if (!members) {
              members = /* @__PURE__ */ new Set();
              this.byDirectory.set(dir, members);
            }
            members.add(path);
          }
          ids.add(id);
        }
      }
      remove(testFile) {
        const id = testFileId(testFile);
        this.unlink(id);
        this.refs.delete(id);
      }
      testFiles() {
        return this.sorted(this.refs.keys());
      }
      /** Test files whose closure contains any of `paths`. */
      referencing(paths) {
        const ids = /* @__PURE__ */ new Set();
        for (const path of paths) {
          for (const id of this.byPath.get(path) ?? []) ids.add(id);
        }
        return this.sorted(ids);
      }
      /** Test files with a closure path directly in `dir` (`""` is the root). */
      inDirectory(dir) {
        return this.referencing(this.byDirectory.get(dir) ?? []);
      }
      /** Test files with a closure path anywhere below `dir`. */
      below(dir) {
        const prefix = `${dir}/`;
        const paths = [];
        for (const [directory, members] of this.byDirectory) {
          if (directory === dir || directory.startsWith(prefix)) paths.push(...members);
        }
        return this.referencing(paths);
      }
      unlink(id) {
        for (const path of this.pathsOf.get(id) ?? []) {
          const ids = this.byPath.get(path);
          if (!ids) continue;
          ids.delete(id);
          if (ids.size > 0) continue;
          this.byPath.delete(path);
          const dir = directoryOf(path);
          const members = this.byDirectory.get(dir);
          members?.delete(path);
          if (members?.size === 0) this.byDirectory.delete(dir);
        }
        this.pathsOf.delete(id);
      }
      sorted(ids) {
        return [...ids].sort(compare).map((id) => this.refs.get(id)).filter((ref) => ref !== void 0);
      }
    };
  }
});

// src/core/keys/key-index.ts
var KeyIndex;
var init_key_index = __esm({
  "src/core/keys/key-index.ts"() {
    "use strict";
    init_check_key();
    init_reverse_index();
    KeyIndex = class {
      constructor(hashOf) {
        this.hashOf = hashOf;
      }
      hashOf;
      reverse = new ReverseIndex();
      keyed = /* @__PURE__ */ new Map();
      paths = /* @__PURE__ */ new Map();
      environments = /* @__PURE__ */ new Map();
      key(testFile) {
        return this.keyed.get(testFileId(testFile))?.key ?? null;
      }
      closure(testFile) {
        return this.keyed.get(testFileId(testFile))?.closure;
      }
      environment(project) {
        return this.environments.get(project);
      }
      /** Sets a project's environment hash and re-keys its test files. */
      setEnvironment(project, envHash) {
        if (this.environments.get(project) === envHash) return [];
        this.environments.set(project, envHash);
        return this.recompute(this.reverse.testFiles().filter((ref) => ref.project === project));
      }
      /**
       * Sets or replaces a test file's closure and keys it. Every path's hash is
       * read again; a path whose hash changed without a `rekey` also re-keys the
       * other test files that reference it. While any path is untracked the test
       * file has no key, and a key it had is dropped (a change to `null`).
       */
      setClosure(closure) {
        const id = testFileId(closure.testFile);
        const previous = this.keyed.get(id);
        const stale = [];
        const entries = closure.paths.map((path) => {
          const entry2 = this.acquire(path);
          if (entry2.references > 1 && this.refresh(path, entry2)) stale.push(path);
          return entry2;
        });
        if (previous) this.release(previous.closure.paths);
        this.keyed.set(id, { closure, entries, key: previous?.key ?? null });
        this.reverse.set(closure.testFile, closure.paths);
        const affected2 = this.reverse.referencing(stale).filter((ref) => testFileId(ref) !== id);
        const untracked = closure.paths.filter((_, i) => entries[i]?.hash === void 0);
        return { changes: this.recompute([closure.testFile, ...affected2]), untracked };
      }
      /** Forgets a deleted test file. Returns whether it was known. */
      removeTestFile(testFile) {
        const id = testFileId(testFile);
        const keyed = this.keyed.get(id);
        if (!keyed) return false;
        this.keyed.delete(id);
        this.reverse.remove(testFile);
        this.release(keyed.closure.paths);
        return true;
      }
      /** Re-reads the hashes of `changedPaths` and re-keys only the test files that reference one. */
      rekey(changedPaths) {
        const changed = [];
        for (const path of new Set(changedPaths)) {
          const entry2 = this.paths.get(path);
          if (entry2 && this.refresh(path, entry2)) changed.push(path);
        }
        return this.recompute(this.reverse.referencing(changed));
      }
      recompute(testFiles) {
        const changes = [];
        for (const testFile of testFiles) {
          const keyed = this.keyed.get(testFileId(testFile));
          const envHash = this.environments.get(testFile.project);
          if (!keyed || envHash === void 0) continue;
          const key = this.keyOf(keyed, envHash);
          if (key === keyed.key) continue;
          changes.push({ testFile, previous: keyed.key, key });
          keyed.key = key;
        }
        return changes;
      }
      /** `null` while any closure path is untracked. */
      keyOf(keyed, envHash) {
        const segments = [];
        for (const entry2 of keyed.entries) {
          if (entry2.hash === void 0) return null;
          segments.push(entry2.segment);
        }
        return keyFromSegments(envHash, keyed.closure.testFile, segments);
      }
      /** The entry of `path` with one more reference; a new entry reads the hash. */
      acquire(path) {
        let entry2 = this.paths.get(path);
        if (!entry2) {
          const hash = this.hashOf(path);
          entry2 = { hash, segment: encodeSegment(path, hash ?? null), references: 0 };
          this.paths.set(path, entry2);
        }
        entry2.references++;
        return entry2;
      }
      release(paths) {
        for (const path of paths) {
          const entry2 = this.paths.get(path);
          if (entry2 && --entry2.references === 0) this.paths.delete(path);
        }
      }
      /** Reads the hash of `path` again. True when it changed. */
      refresh(path, entry2) {
        const hash = this.hashOf(path);
        if (hash === entry2.hash) return false;
        entry2.hash = hash;
        entry2.segment = encodeSegment(path, hash ?? null);
        return true;
      }
    };
  }
});

// src/core/keys/resolution.ts
import { posix as posix3 } from "node:path";
function closuresToReresolve(changes, index, isDeclaredInput) {
  const picked = /* @__PURE__ */ new Map();
  const pick = (refs) => {
    for (const ref of refs) picked.set(testFileId(ref), ref);
  };
  for (const change of changes) {
    if (change.oldHash !== null && change.newHash !== null) continue;
    if (isDeclaredInput(change.path)) return index.testFiles();
    const dir = directoryOf(change.path);
    const base = posix3.basename(change.path);
    const dot = base.lastIndexOf(".");
    const name = dot > 0 ? base.slice(0, dot) : base;
    pick(index.inDirectory(dir));
    pick(index.below(dir === "" ? name : `${dir}/${name}`));
    if (name === "index" && dir !== "") pick(index.inDirectory(directoryOf(dir)));
  }
  return [...picked.keys()].sort(compare).map((id) => picked.get(id));
}
var init_resolution = __esm({
  "src/core/keys/resolution.ts"() {
    "use strict";
    init_fs();
    init_reverse_index();
  }
});

// src/core/keys/index.ts
var init_keys = __esm({
  "src/core/keys/index.ts"() {
    "use strict";
    init_check_key();
    init_closure();
    init_environment();
    init_glob();
    init_key_index();
    init_resolution();
    init_reverse_index();
  }
});

// src/core/state/fingerprint.ts
import { realpathSync as realpathSync2 } from "node:fs";
import { tmpdir } from "node:os";
function tempPrefixes() {
  const dir = tmpdir().replace(/\/+$/, "");
  let real = dir;
  try {
    real = realpathSync2(dir);
  } catch {
  }
  return [.../* @__PURE__ */ new Set([dir, real, "/tmp"])].filter((p) => p !== "").sort((a, b) => b.length - a.length);
}
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function firstLine(text) {
  const line = text.replace(ANSI, "").split(/\r?\n/).find((l) => l.trim() !== "");
  return (line ?? "").trim().replace(/\s+/g, " ");
}
function normalize(line) {
  return VOLATILE.reduce(
    (text, [pattern, replacement]) => text.replace(pattern, replacement),
    line
  );
}
function cap(text, max) {
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
}
function where(location2) {
  return location2 === null ? "?" : `${location2.path}:${location2.line}:${location2.column}`;
}
function describeFailure(errors, fallback) {
  const first = errors[0];
  if (first === void 0) {
    return { fingerprint: `fail @ ${where(fallback)}`, summary: "failed without an error message" };
  }
  const line = firstLine(first.message);
  const location2 = first.location ?? fallback;
  const more = errors.length - 1;
  const text = line === "" ? first.name : line;
  const summary = more > 0 ? `${text} (${more} more error${more === 1 ? "" : "s"})` : text;
  return {
    fingerprint: `${first.name}: ${normalize(line)} @ ${where(location2)}`,
    summary: cap(summary, SUMMARY_MAX_CHARS)
  };
}
var SUMMARY_MAX_CHARS, ANSI, VOLATILE;
var init_fingerprint = __esm({
  "src/core/state/fingerprint.ts"() {
    "use strict";
    SUMMARY_MAX_CHARS = 300;
    ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
    VOLATILE = [
      [/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "<time>"],
      [/\b\d+(?:\.\d+)?\s?ms\b/g, "<n>ms"],
      [/\b0x[0-9a-f]+\b/gi, "0x<addr>"],
      // A cache path names a tool's scratch space; its segments are hashes and run ids.
      [/(?:[^\s'"`(]*\/)?node_modules\/\.cache\/[^\s'"`):,]*/g, "<cache>"],
      ...tempPrefixes().map((prefix) => [
        new RegExp(`(?<![\\w.-])${escapeRegExp(prefix)}/[^\\s/'"\`):,]+`, "g"),
        "<tmp>"
      ]),
      [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>"],
      // At least one letter, so a long decimal value in an assertion is kept.
      [/\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, "<hex>"]
    ];
  }
});

// src/core/state/derive.ts
function checkIdentity(check) {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}
function testFileKeyOf(check) {
  return testFileId(testFileOf(check));
}
function testFileOf(check) {
  return { project: check.project, path: check.testPath };
}
function classify(outcome, resultKey, key) {
  if (key !== void 0 && resultKey !== null && resultKey === key.key) {
    return { validity: "current", pendingPhase: null };
  }
  if (key?.pending) return { validity: "pending", pendingPhase: key.pending };
  return { validity: outcome === "unknown" ? "unknown" : "stale", pendingPhase: null };
}
function originOf(worktreeId, result) {
  const p = result.provenance;
  return p.worktreeId === worktreeId ? { kind: "own" } : { kind: "inherited", worktreeId: p.worktreeId, commit: p.commit };
}
function sameOrigin(a, b) {
  if (a === null || a.kind !== b.kind) return false;
  return a.kind === "own" || b.kind === "inherited" && a.worktreeId === b.worktreeId && a.commit === b.commit;
}
function stateFromResult(worktreeId, revision, result, key, previous) {
  const origin = originOf(worktreeId, result);
  const failed2 = result.outcome === "fail";
  const described = failed2 && (result.fingerprint === null || result.summary === null);
  const fallback = described ? describeFailure(result.errors, result.location) : null;
  const fingerprint = failed2 ? result.fingerprint ?? fallback?.fingerprint ?? null : null;
  const unchanged = previous !== null && previous.outcome === result.outcome && previous.fingerprint === fingerprint && previous.commit === result.provenance.commit && sameOrigin(previous.origin, origin);
  const observedAt = origin.kind === "own" ? result.provenance.revision : unchanged && previous.observedAt !== null ? previous.observedAt : revision;
  return {
    worktreeId,
    check: result.check,
    outcome: result.outcome,
    ...classify(result.outcome, result.key, key),
    observedAt,
    commit: result.provenance.commit,
    origin,
    durationMs: result.durationMs,
    location: failed2 ? result.errors[0]?.location ?? result.location : result.location,
    summary: failed2 ? result.summary ?? fallback?.summary ?? null : null,
    fingerprint
  };
}
function stateWithoutResult(previous, key) {
  return { ...previous, ...classify(previous.outcome, null, key) };
}
function unknownState(previous, revision, key, reason2) {
  return {
    ...previous,
    outcome: "unknown",
    ...classify("unknown", null, key),
    observedAt: revision,
    durationMs: null,
    summary: reason2,
    fingerprint: null
  };
}
function sameLocation(a, b) {
  if (a === null || b === null) return a === b;
  return a.path === b.path && a.line === b.line && a.column === b.column;
}
function sameState(a, b) {
  return a.worktreeId === b.worktreeId && checkIdentity(a.check) === checkIdentity(b.check) && a.outcome === b.outcome && a.validity === b.validity && a.pendingPhase === b.pendingPhase && a.observedAt === b.observedAt && a.commit === b.commit && (a.origin === null || b.origin === null ? a.origin === b.origin : sameOrigin(a.origin, b.origin)) && a.durationMs === b.durationMs && sameLocation(a.location, b.location) && a.summary === b.summary && a.fingerprint === b.fingerprint;
}
var init_derive = __esm({
  "src/core/state/derive.ts"() {
    "use strict";
    init_keys();
    init_fingerprint();
  }
});

// src/core/state/baseline.ts
function entry(check, fingerprint) {
  return `${checkIdentity(check)}\0${fingerprint ?? ""}`;
}
function read(store, worktreeId) {
  const raw = store.meta.get(metaKey(worktreeId));
  return raw === null ? null : JSON.parse(raw);
}
function recordBaselineFindings(store, worktreeId, checkpointId, transitions) {
  if (transitions.length === 0) return;
  const baseline = checkpointId !== null && store.checkpoints.get(checkpointId)?.kind === "baseline";
  const current = read(store, worktreeId);
  if (!baseline && current === null) return;
  const fresh = baseline && current?.checkpointId !== checkpointId;
  const entries = new Set(fresh ? [] : current?.entries);
  const touched = new Set(transitions.map((t) => checkIdentity(t.check)));
  for (const e of entries) if (touched.has(e.slice(0, e.lastIndexOf("\0")))) entries.delete(e);
  if (baseline) {
    for (const t of transitions) {
      if (t.kind === "first-seen-fail") entries.add(entry(t.check, t.toFingerprint));
    }
  }
  const id = baseline ? checkpointId : current?.checkpointId ?? "";
  const next = { checkpointId: id, entries: [...entries] };
  store.meta.set(metaKey(worktreeId), JSON.stringify(next));
}
function baselineFindings(store, worktreeId) {
  const entries = new Set(read(store, worktreeId)?.entries);
  return (check, fingerprint) => entries.has(entry(check, fingerprint));
}
var metaKey;
var init_baseline = __esm({
  "src/core/state/baseline.ts"() {
    "use strict";
    init_derive();
    metaKey = (worktreeId) => `state.baseline-findings.${worktreeId}`;
  }
});

// src/core/state/check-name.ts
function formatCheck(check) {
  const project = check.project === "" ? "" : `[${check.project}] `;
  return check.kind === "test" ? `${project}${check.testPath} > ${check.fullName}` : `${project}${check.testPath}${FILE_LEVEL}`;
}
function parseCheck(name) {
  const match = /^(?:\[([^\]]*)\] )?(.+)$/s.exec(name.trim());
  if (match === null) return null;
  const project = match[1] ?? "";
  const rest = match[2] ?? "";
  const split = rest.indexOf(" > ");
  if (split === -1) {
    const testPath = rest.endsWith(FILE_LEVEL) ? rest.slice(0, -FILE_LEVEL.length) : rest;
    return { kind: "file", project, testPath };
  }
  return {
    kind: "test",
    project,
    testPath: rest.slice(0, split),
    fullName: rest.slice(split + 3)
  };
}
var FILE_LEVEL;
var init_check_name = __esm({
  "src/core/state/check-name.ts"() {
    "use strict";
    FILE_LEVEL = " (file-level)";
  }
});

// src/core/types/common.ts
var PAYLOAD_SCHEMA_VERSION;
var init_common = __esm({
  "src/core/types/common.ts"() {
    "use strict";
    PAYLOAD_SCHEMA_VERSION = 1;
  }
});

// src/core/types/daemon.ts
var DAEMON_SOCKET_TIMEOUT_MS;
var init_daemon = __esm({
  "src/core/types/daemon.ts"() {
    "use strict";
    DAEMON_SOCKET_TIMEOUT_MS = 100;
  }
});

// src/core/types/delivery.ts
var init_delivery = __esm({
  "src/core/types/delivery.ts"() {
    "use strict";
  }
});

// src/core/types/policy.ts
var DEFAULT_POLICY;
var init_policy = __esm({
  "src/core/types/policy.ts"() {
    "use strict";
    DEFAULT_POLICY = {
      interrupt: { onRegression: true },
      stop: { blockOnKnownFailures: false, requireFullSuite: false, waitMs: 0 },
      baseline: { onStart: "lookup-then-run-missing" },
      inputs: [],
      env: { allowlist: [] },
      runner: { tierSize: 4, timeoutMs: 6e5, maxConcurrentRuns: 1 },
      daemon: { idleExitMinutes: 60 },
      store: { retentionDays: 7, maxSizeMb: null }
    };
  }
});

// src/core/types/scheduler.ts
function notesMetaKey(worktreeId) {
  return `notes.${worktreeId}`;
}
function refinedMetaKey(worktreeId) {
  return `refined.${worktreeId}`;
}
var MAX_PERSISTED_NOTES;
var init_scheduler = __esm({
  "src/core/types/scheduler.ts"() {
    "use strict";
    MAX_PERSISTED_NOTES = 20;
  }
});

// src/core/types/state.ts
var init_state = __esm({
  "src/core/types/state.ts"() {
    "use strict";
  }
});

// src/core/types/store-records.ts
var CONSUMER_EXPIRY_MS, WAITERLESS_EXPIRY_MS;
var init_store_records = __esm({
  "src/core/types/store-records.ts"() {
    "use strict";
    CONSUMER_EXPIRY_MS = 12 * 60 * 60 * 1e3;
    WAITERLESS_EXPIRY_MS = 10 * 60 * 1e3;
  }
});

// src/core/types/watcher.ts
var WATCHER_TIMINGS;
var init_watcher = __esm({
  "src/core/types/watcher.ts"() {
    "use strict";
    WATCHER_TIMINGS = {
      quietMs: 100,
      maxBatchMs: 500,
      reconcileIntervalMs: 3e4
    };
  }
});

// src/core/types/index.ts
var init_types = __esm({
  "src/core/types/index.ts"() {
    "use strict";
    init_common();
    init_daemon();
    init_delivery();
    init_policy();
    init_scheduler();
    init_state();
    init_store_records();
    init_watcher();
  }
});

// src/core/state/header.ts
function readHeader(store, worktreeId, states = store.knownStates.list(worktreeId), keys = store.testFileKeys.list(worktreeId)) {
  const revision = store.revisions.latest(worktreeId)?.number ?? 0;
  const counts2 = { current: 0, pending: 0, stale: 0, unknown: 0 };
  let inheritedCount = 0;
  for (const state of states) {
    counts2[state.validity]++;
    if (state.validity === "current" && state.origin?.kind === "inherited") inheritedCount++;
  }
  const last = store.checkpoints.lastCompleted(worktreeId);
  const refinedRevision = readRefined(store, worktreeId);
  return {
    revision,
    counts: counts2,
    testFilesWithoutChecks: countFilesWithoutChecks(states, keys),
    fullSuite: {
      atCurrentRevision: last !== null && last.revision === revision,
      lastCompletedRevision: last?.revision ?? null
    },
    testFilesListed: keys.length > 0 || last !== null,
    inheritedCount,
    refinedRevision,
    runnerPartPending: refinedRevision !== null && refinedRevision < revision
  };
}
function readRefined(store, worktreeId) {
  const raw = store.meta.get(refinedMetaKey(worktreeId));
  const value = raw === null ? Number.NaN : Number(raw);
  return Number.isInteger(value) ? value : null;
}
function isPending(header) {
  return header.counts.pending + header.testFilesWithoutChecks.pending > 0 || header.runnerPartPending === true;
}
function runnerPartText(revision) {
  return `the runner part of revision ${revision}`;
}
function fullSuiteText({ revision, fullSuite }) {
  if (fullSuite.atCurrentRevision) return `completed at revision ${revision}`;
  return fullSuite.lastCompletedRevision === null ? "none completed at any revision" : `none completed at revision ${revision}; last completed at revision ${fullSuite.lastCompletedRevision}`;
}
function countFilesWithoutChecks(states, keys) {
  const withChecks = new Set(states.map((s) => testFileKeyOf(s.check)));
  const counts2 = { pending: 0, unknown: 0 };
  for (const row of keys) {
    if (withChecks.has(testFileId(row.testFile))) continue;
    counts2[hasKey(row) && row.pending !== null ? "pending" : "unknown"]++;
  }
  return counts2;
}
function hasKey(row) {
  return row.key !== null;
}
function toKnownFailure(state, revision) {
  if (state.outcome !== "fail") return null;
  return {
    check: state.check,
    outcome: "fail",
    validity: state.validity,
    observedAt: state.observedAt ?? revision,
    summary: state.summary ?? "",
    fingerprint: state.fingerprint ?? "",
    location: state.location
  };
}
var init_header = __esm({
  "src/core/state/header.ts"() {
    "use strict";
    init_keys();
    init_types();
    init_derive();
  }
});

// src/core/state/transitions.ts
function transitionKind(from, to) {
  const before = from?.outcome ?? null;
  switch (to.outcome) {
    case "fail":
      if (before === "pass") return "pass-to-fail";
      if (before === "fail") return from?.fingerprint === to.fingerprint ? null : "fail-changed";
      return "first-seen-fail";
    case "pass":
      return before === "fail" ? "fail-to-pass" : null;
    case "unknown":
      return before === "pass" || before === "fail" ? "to-unknown" : null;
    case "skip":
      return null;
  }
}
var init_transitions = __esm({
  "src/core/state/transitions.ts"() {
    "use strict";
  }
});

// src/core/state/sink.ts
function createStateSink(store, options = {}) {
  const now = options.now ?? Date.now;
  function begin(worktreeId) {
    const previous = new Map(
      store.knownStates.list(worktreeId).map((s) => [checkIdentity(s.check), s])
    );
    const keys = new Map(
      store.testFileKeys.list(worktreeId).map((k) => [testFileId(k.testFile), k])
    );
    const keyOf = (state) => keys.get(testFileKeyOf(state.check));
    const prior = (state) => previous.get(checkIdentity(state.check)) ?? null;
    const commit = (revision, next, checkpointId) => {
      const at = now();
      const changed = [];
      const recorded2 = [];
      for (const state of next) {
        const before = prior(state);
        if (before !== null && sameState(before, state)) continue;
        changed.push(state);
        const kind = transitionKind(before, state);
        if (kind === null) continue;
        recorded2.push({
          worktreeId,
          check: state.check,
          kind,
          from: before?.outcome ?? null,
          to: state.outcome,
          fromFingerprint: before?.fingerprint ?? null,
          toFingerprint: state.fingerprint,
          revision,
          at
        });
      }
      store.knownStates.upsertMany(changed);
      store.transitions.append(recorded2);
      recordBaselineFindings(store, worktreeId, checkpointId, recorded2);
      return recorded2;
    };
    return { previous, keys, keyOf, prior, commit };
  }
  return {
    applyResults: (worktreeId, revision, results2, provenance) => store.transaction(() => {
      const { keyOf, prior, commit } = begin(worktreeId);
      const next = results2.map(
        (r) => stateFromResult(worktreeId, revision, r, keyOf(r), prior(r))
      );
      return commit(revision, next, provenance.checkpointId);
    }),
    markUnknown: (worktreeId, revision, testFiles, reason2) => store.transaction(() => {
      const { previous, keyOf, commit } = begin(worktreeId);
      const files = new Set(testFiles.map(testFileId));
      const next = [...previous.values()].filter((s) => files.has(testFileKeyOf(s.check))).map((s) => unknownState(s, revision, keyOf(s), reason2));
      return commit(revision, next, null);
    }),
    refresh: (worktreeId, revision, provenance, testFiles) => store.transaction(() => {
      const { previous, keys, keyOf, prior, commit } = begin(worktreeId);
      const only = testFiles === void 0 ? null : new Set(testFiles.map(testFileId));
      const included = (file) => only === null || only.has(file);
      const at = now();
      const next = /* @__PURE__ */ new Map();
      for (const [file, key] of keys) {
        if (!included(file)) continue;
        for (const r of store.results.byKey(key.key, at)) {
          next.set(
            checkIdentity(r.check),
            stateFromResult(worktreeId, revision, r, key, prior(r))
          );
        }
      }
      for (const [id, state] of previous) {
        const key = keyOf(state);
        if (key === void 0 || next.has(id)) continue;
        if (included(testFileId(key.testFile))) next.set(id, stateWithoutResult(state, key));
      }
      return commit(revision, [...next.values()], provenance.checkpointId);
    }),
    // A told failure stays in the view: delivery reports it once as no longer reported (D6).
    retire: (worktreeId, checks) => store.transaction(() => {
      store.knownStates.removeMany(worktreeId, checks);
      const retired = new Set(checks.map(checkIdentity));
      for (const { consumer } of store.consumers.list(worktreeId)) {
        const silent = store.views.list(consumer).filter((v) => v.outcome !== "fail" && retired.has(checkIdentity(v.check))).map((v) => v.check);
        store.views.removeMany(consumer, silent);
      }
    })
  };
}
var init_sink = __esm({
  "src/core/state/sink.ts"() {
    "use strict";
    init_keys();
    init_baseline();
    init_derive();
    init_transitions();
  }
});

// src/core/state/index.ts
var state_exports = {};
__export(state_exports, {
  SUMMARY_MAX_CHARS: () => SUMMARY_MAX_CHARS,
  baselineFindings: () => baselineFindings,
  checkIdentity: () => checkIdentity,
  classify: () => classify,
  createStateSink: () => createStateSink,
  describeFailure: () => describeFailure,
  formatCheck: () => formatCheck,
  fullSuiteText: () => fullSuiteText,
  isPending: () => isPending,
  parseCheck: () => parseCheck,
  readHeader: () => readHeader,
  runnerPartText: () => runnerPartText,
  testFileKeyOf: () => testFileKeyOf,
  testFileOf: () => testFileOf,
  toKnownFailure: () => toKnownFailure,
  transitionKind: () => transitionKind
});
var init_state2 = __esm({
  "src/core/state/index.ts"() {
    "use strict";
    init_baseline();
    init_check_name();
    init_derive();
    init_fingerprint();
    init_header();
    init_sink();
    init_transitions();
  }
});

// src/core/store/connection.ts
function rollback(db) {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    if (!/no transaction is active/.test(String(error))) throw error;
  }
}
var Connection;
var init_connection = __esm({
  "src/core/store/connection.ts"() {
    "use strict";
    Connection = class {
      #statements = /* @__PURE__ */ new Map();
      #depth = 0;
      #closed = false;
      db;
      constructor(db) {
        this.db = db;
      }
      /** Runs a statement; returns the number of rows it changed. */
      run(sql, ...params) {
        return Number(this.#statement(sql).run(...params).changes);
      }
      get(sql, ...params) {
        return this.#statement(sql).get(...params) ?? null;
      }
      all(sql, ...params) {
        return this.#statement(sql).all(...params);
      }
      /**
       * Runs `fn` in a `BEGIN IMMEDIATE` transaction, or in a savepoint when one
       * is already open. Spec 001 D8: "short `BEGIN IMMEDIATE` write
       * transactions": the write lock is taken up front, so a writer waits on the
       * busy timeout instead of failing to upgrade a read snapshot.
       */
      transaction(fn) {
        const savepoint = this.#depth > 0 ? `squeal_${this.#depth}` : null;
        this.db.exec(savepoint === null ? "BEGIN IMMEDIATE" : `SAVEPOINT ${savepoint}`);
        this.#depth++;
        try {
          const result = fn();
          this.db.exec(savepoint === null ? "COMMIT" : `RELEASE ${savepoint}`);
          return result;
        } catch (error) {
          if (savepoint === null) rollback(this.db);
          else this.db.exec(`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`);
          throw error;
        } finally {
          this.#depth--;
        }
      }
      /** Idempotent. */
      close() {
        if (this.#closed) return;
        this.#closed = true;
        this.#statements.clear();
        this.db.close();
      }
      #statement(sql) {
        let statement = this.#statements.get(sql);
        if (statement === void 0) {
          statement = this.db.prepare(sql);
          this.#statements.set(sql, statement);
        }
        return statement;
      }
    };
  }
});

// src/core/store/paths.ts
import { join as join5 } from "node:path";
function storePaths(commonDir) {
  const dir = join5(commonDir, "squeal");
  return {
    dir,
    database: join5(dir, "store.sqlite"),
    runsDir: join5(dir, "runs"),
    locksDir: join5(dir, "locks")
  };
}
function lockFileFor(commonDir, worktreeId) {
  return join5(storePaths(commonDir).locksDir, `${worktreeId}.sqlite`);
}
var init_paths2 = __esm({
  "src/core/store/paths.ts"() {
    "use strict";
    init_fs();
  }
});

// src/core/store/schema.ts
function userVersion(db) {
  return Number(db.prepare("PRAGMA user_version").get()?.user_version ?? 0);
}
function migrate(db, migrations = MIGRATIONS) {
  if (userVersion(db) >= migrations.length) return userVersion(db);
  db.exec("BEGIN IMMEDIATE");
  try {
    const from = userVersion(db);
    for (let version = from; version < migrations.length; version++) {
      migrations[version]?.(db);
    }
    if (from < migrations.length) db.exec(`PRAGMA user_version = ${migrations.length}`);
    db.exec("COMMIT");
  } catch (error) {
    rollback(db);
    throw error;
  }
  return userVersion(db);
}
var V1, MIGRATIONS, SCHEMA_VERSION;
var init_schema = __esm({
  "src/core/store/schema.ts"() {
    "use strict";
    init_connection();
    V1 = `
CREATE TABLE meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
) STRICT;

CREATE TABLE worktrees (
  id TEXT PRIMARY KEY,
  root TEXT NOT NULL,
  common_dir TEXT NOT NULL,
  is_main INTEGER NOT NULL,
  registered_at INTEGER NOT NULL,
  daemon_socket TEXT,
  daemon_started_at INTEGER,
  daemon_heartbeat_at INTEGER,
  daemon_heartbeat_interval_ms INTEGER,
  daemon_version TEXT
) STRICT;

CREATE TABLE revisions (
  worktree_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  head TEXT,
  dirty INTEGER NOT NULL,
  trigger TEXT NOT NULL,
  changes TEXT NOT NULL,
  PRIMARY KEY (worktree_id, number)
) STRICT;

CREATE TABLE file_hashes (
  worktree_id TEXT NOT NULL,
  path TEXT NOT NULL,
  mtime_ms REAL NOT NULL,
  ctime_ms REAL NOT NULL,
  size INTEGER NOT NULL,
  inode INTEGER NOT NULL,
  hash TEXT NOT NULL,
  PRIMARY KEY (worktree_id, path)
) STRICT, WITHOUT ROWID;

CREATE TABLE test_files (
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  closure_paths TEXT NOT NULL,
  complete INTEGER NOT NULL,
  method TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT NOT NULL,
  PRIMARY KEY (project, path)
) STRICT;

CREATE TABLE test_file_keys (
  worktree_id TEXT NOT NULL,
  project TEXT NOT NULL,
  path TEXT NOT NULL,
  key TEXT,
  revision INTEGER NOT NULL,
  pending TEXT,
  PRIMARY KEY (worktree_id, project, path)
) STRICT;
CREATE INDEX test_file_keys_by_key ON test_file_keys (key);

CREATE TABLE checks (
  id INTEGER PRIMARY KEY,
  kind TEXT NOT NULL,
  project TEXT NOT NULL,
  test_path TEXT NOT NULL,
  full_name TEXT NOT NULL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  templated INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  UNIQUE (project, test_path, kind, full_name)
) STRICT;

CREATE TABLE failure_texts (
  id TEXT PRIMARY KEY,
  summary TEXT,
  errors TEXT NOT NULL
) STRICT;

CREATE TABLE results (
  check_id INTEGER NOT NULL,
  key TEXT NOT NULL,
  outcome TEXT NOT NULL,
  duration_ms REAL NOT NULL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  fingerprint TEXT,
  failure_id TEXT,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  commit_sha TEXT,
  dirty INTEGER NOT NULL,
  run_id TEXT NOT NULL,
  recorded_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  PRIMARY KEY (check_id, key)
) STRICT;
CREATE INDEX results_by_key ON results (key);
CREATE INDEX results_by_check_time ON results (check_id, recorded_at);
CREATE INDEX results_by_time ON results (recorded_at);
CREATE INDEX results_by_last_use ON results (last_used_at);
CREATE INDEX results_by_worktree ON results (worktree_id, check_id, recorded_at);
CREATE INDEX results_by_run ON results (run_id);
CREATE INDEX results_by_failure ON results (failure_id);

CREATE TABLE checkpoints (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL,
  test_files TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  end_state TEXT
) STRICT;
CREATE INDEX checkpoints_by_worktree ON checkpoints (worktree_id, end_state, completed_at);

CREATE TABLE runs (
  id TEXT PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  test_files TEXT NOT NULL,
  checkpoint_id TEXT,
  log_dir TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  end_state TEXT
) STRICT;
CREATE INDEX runs_by_checkpoint ON runs (checkpoint_id);

CREATE TABLE known_states (
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  validity TEXT NOT NULL,
  pending_phase TEXT,
  observed_at INTEGER,
  commit_sha TEXT,
  origin_kind TEXT,
  origin_worktree TEXT,
  origin_commit TEXT,
  duration_ms REAL,
  location_path TEXT,
  location_line INTEGER,
  location_column INTEGER,
  summary TEXT,
  fingerprint TEXT,
  PRIMARY KEY (worktree_id, check_id)
) STRICT;

CREATE TABLE transitions (
  id INTEGER PRIMARY KEY,
  worktree_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  kind TEXT NOT NULL,
  from_outcome TEXT,
  to_outcome TEXT NOT NULL,
  from_fingerprint TEXT,
  to_fingerprint TEXT,
  revision INTEGER NOT NULL,
  at INTEGER NOT NULL
) STRICT;
CREATE INDEX transitions_by_check ON transitions (worktree_id, check_id, id);

CREATE TABLE consumers (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  registered_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_delivered_at INTEGER,
  PRIMARY KEY (worktree_id, session_id, agent_id)
) STRICT;

CREATE TABLE consumer_views (
  worktree_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  fingerprint TEXT,
  told_at INTEGER NOT NULL,
  PRIMARY KEY (worktree_id, session_id, agent_id, check_id)
) STRICT;
`;
    MIGRATIONS = [(db) => db.exec(V1)];
    SCHEMA_VERSION = MIGRATIONS.length;
  }
});

// src/core/store/codec.ts
function str(row, column) {
  const value = row[column];
  if (typeof value !== "string") throw new TypeError(`squeal store: ${column} is not text`);
  return value;
}
function strOrNull(row, column) {
  return row[column] === null ? null : str(row, column);
}
function num(row, column) {
  const value = row[column];
  if (typeof value !== "number") throw new TypeError(`squeal store: ${column} is not a number`);
  return value;
}
function numOrNull(row, column) {
  return row[column] === null ? null : num(row, column);
}
function bool(row, column) {
  return num(row, column) !== 0;
}
function json(row, column) {
  return JSON.parse(str(row, column));
}
function oneOf(row, column, values) {
  const value = str(row, column);
  if (!values.includes(value)) {
    throw new TypeError(`squeal store: ${column} has unexpected value ${value}`);
  }
  return value;
}
function oneOfOrNull(row, column, values) {
  return row[column] === null ? null : oneOf(row, column, values);
}
function locationParams(location2) {
  return [location2?.path ?? null, location2?.line ?? null, location2?.column ?? null];
}
function location(row) {
  const path = strOrNull(row, "location_path");
  if (path === null) return null;
  return { path, line: num(row, "location_line"), column: num(row, "location_column") };
}
function checkParams(check) {
  return [
    check.project,
    check.testPath,
    check.kind,
    check.kind === "test" ? check.fullName : ""
  ];
}
function checkFrom(row) {
  const project = str(row, "check_project");
  const testPath = str(row, "check_test_path");
  if (oneOf(row, "check_kind", ["test", "file"]) === "file") {
    return { kind: "file", project, testPath };
  }
  return { kind: "test", project, testPath, fullName: str(row, "check_full_name") };
}
function findCheckId(conn, check) {
  const row = conn.get(`SELECT id FROM checks WHERE ${CHECK_WHERE}`, ...checkParams(check));
  return row === null ? null : num(row, "id");
}
function ensureCheckId(conn, check, seenAt) {
  conn.run(
    `INSERT INTO checks (project, test_path, kind, full_name, templated, first_seen_at)
     VALUES (?, ?, ?, ?, 0, ?) ON CONFLICT DO NOTHING`,
    ...checkParams(check),
    seenAt
  );
  const id = findCheckId(conn, check);
  if (id === null) throw new Error(`squeal store: check row missing after insert`);
  return id;
}
function flag(value) {
  return value ? 1 : 0;
}
var CHECK_WHERE, CHECK_COLUMNS;
var init_codec = __esm({
  "src/core/store/codec.ts"() {
    "use strict";
    CHECK_WHERE = "project = ? AND test_path = ? AND kind = ? AND full_name = ?";
    CHECK_COLUMNS = "c.project AS check_project, c.test_path AS check_test_path, c.kind AS check_kind, c.full_name AS check_full_name";
  }
});

// src/core/store/prune.ts
import { existsSync as existsSync2, rmSync } from "node:fs";
import { join as join6, resolve as resolve2, sep as sep3 } from "node:path";
function prune(conn, worktrees, paths, options) {
  const cutoff = options.now - options.retentionDays * DAY_MS;
  let worktreesRemoved = 0;
  for (const worktree of worktrees.list()) {
    if (existsSync2(join6(worktree.root, ".git"))) continue;
    worktrees.remove(worktree.id);
    worktreesRemoved++;
  }
  let resultsRemoved = conn.transaction(() => {
    const removed = conn.run(
      `DELETE FROM results
       WHERE key NOT IN (${LIVE_KEYS})
         AND rowid NOT IN (${MAIN_NEWEST})
         AND (recorded_at < ? OR worktree_id NOT IN (SELECT id FROM worktrees))`,
      cutoff
    );
    dropOrphanFailureTexts(conn);
    return removed;
  });
  if (options.maxSizeMb !== null) {
    resultsRemoved += evictToCap(conn, options.maxSizeMb * 1024 * 1024);
  }
  const droppedRuns = conn.transaction(
    () => conn.all(
      `DELETE FROM runs
       WHERE NOT EXISTS (SELECT 1 FROM results r WHERE r.run_id = runs.id)
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(ended_at, started_at) < ?))
       RETURNING log_dir`,
      cutoff
    )
  );
  for (const row of droppedRuns) removeRunLog(paths, str(row, "log_dir"));
  const checkpointsRemoved = conn.transaction(
    () => conn.run(
      `DELETE FROM checkpoints
       WHERE id NOT IN (${LAST_COMPLETED_CHECKPOINTS})
         AND NOT EXISTS (SELECT 1 FROM runs r WHERE r.checkpoint_id = checkpoints.id)
         AND (worktree_id NOT IN (SELECT id FROM worktrees)
              OR (end_state IS NOT NULL AND coalesce(completed_at, started_at) < ?))`,
      cutoff
    )
  );
  const checksRemoved = conn.transaction(
    () => conn.run(
      `DELETE FROM checks WHERE id NOT IN (
         SELECT check_id FROM results UNION SELECT check_id FROM known_states
         UNION SELECT check_id FROM consumer_views UNION SELECT check_id FROM transitions)`
    )
  );
  conn.db.exec("PRAGMA incremental_vacuum");
  return {
    resultsRemoved,
    runsRemoved: droppedRuns.length,
    checkpointsRemoved,
    checksRemoved,
    worktreesRemoved,
    bytesAfter: pragmaNumber(conn, "page_count") * pragmaNumber(conn, "page_size")
  };
}
function evictToCap(conn, capBytes) {
  const tiers = [
    `key NOT IN (${LIVE_KEYS}) AND rowid NOT IN (${MAIN_NEWEST})`,
    `key NOT IN (${LIVE_KEYS})`
  ];
  let removed = 0;
  for (const tier of tiers) {
    while (usedBytes(conn) > capBytes) {
      const batch = conn.transaction(() => {
        const n = conn.run(
          `DELETE FROM results WHERE rowid IN (
             SELECT rowid FROM results WHERE ${tier} ORDER BY last_used_at, rowid LIMIT ?)`,
          EVICTION_BATCH
        );
        dropOrphanFailureTexts(conn);
        return n;
      });
      if (batch === 0) break;
      removed += batch;
    }
  }
  return removed;
}
function dropOrphanFailureTexts(conn) {
  conn.run(
    `DELETE FROM failure_texts
     WHERE id NOT IN (SELECT failure_id FROM results WHERE failure_id IS NOT NULL)`
  );
}
function usedBytes(conn) {
  const pages = pragmaNumber(conn, "page_count") - pragmaNumber(conn, "freelist_count");
  return pages * pragmaNumber(conn, "page_size");
}
function pragmaNumber(conn, name) {
  const row = conn.get(`PRAGMA ${name}`);
  if (row === null) throw new Error(`squeal store: PRAGMA ${name} returned nothing`);
  return num(row, name);
}
function removeRunLog(paths, logDir) {
  const runsDir = resolve2(paths.runsDir);
  const target = resolve2(logDir);
  if (target.startsWith(runsDir + sep3)) rmSync(target, { recursive: true, force: true });
}
var DAY_MS, EVICTION_BATCH, LIVE_KEYS, MAIN_NEWEST, LAST_COMPLETED_CHECKPOINTS;
var init_prune = __esm({
  "src/core/store/prune.ts"() {
    "use strict";
    init_codec();
    DAY_MS = 24 * 60 * 60 * 1e3;
    EVICTION_BATCH = 32;
    LIVE_KEYS = `SELECT k.key FROM test_file_keys k JOIN worktrees w ON w.id = k.worktree_id
  WHERE k.key IS NOT NULL`;
    MAIN_NEWEST = `
  SELECT id FROM (
    SELECT rowid AS id,
      row_number() OVER (PARTITION BY check_id ORDER BY recorded_at DESC, rowid DESC) AS n
    FROM results WHERE worktree_id IN (SELECT id FROM worktrees WHERE is_main = 1)
  ) WHERE n = 1`;
    LAST_COMPLETED_CHECKPOINTS = `
  SELECT id FROM (
    SELECT (SELECT x.id FROM checkpoints x
            WHERE x.worktree_id = w.id AND x.end_state = 'completed'
            ORDER BY x.completed_at DESC, x.rowid DESC LIMIT 1) AS id
    FROM worktrees w
  ) WHERE id IS NOT NULL`;
  }
});

// src/core/store/repos/consumers.ts
function consumerParams(c) {
  return [c.worktreeId, c.sessionId, c.agentId];
}
function createConsumerRepo(conn) {
  const unregister = (consumer) => conn.transaction(() => {
    conn.run(`DELETE FROM consumer_views WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
    conn.run(`DELETE FROM consumers WHERE ${WHERE_CONSUMER}`, ...consumerParams(consumer));
  });
  const idleSince = (cutoff) => conn.all(
    `SELECT * FROM consumers
         WHERE last_seen_at < ? AND coalesce(last_delivered_at, 0) < ?
         ORDER BY worktree_id, session_id, agent_id`,
    cutoff,
    cutoff
  ).map(toConsumer);
  return {
    get: (consumer) => {
      const row = conn.get(
        `SELECT * FROM consumers WHERE ${WHERE_CONSUMER}`,
        ...consumerParams(consumer)
      );
      return row === null ? null : toConsumer(row);
    },
    list: (worktreeId) => conn.all(
      "SELECT * FROM consumers WHERE worktree_id = ? ORDER BY session_id, agent_id",
      worktreeId
    ).map(toConsumer),
    /**
     * A registration starts from an empty view: spec 001 D6 seeds the view
     * with the current known state on registration, so entries left by an
     * earlier registration of the same consumer are dropped.
     */
    register: (consumer, at) => conn.transaction(() => {
      unregister(consumer);
      conn.run(
        `INSERT INTO consumers (worktree_id, session_id, agent_id, registered_at, last_seen_at)
           VALUES (?, ?, ?, ?, ?)`,
        ...consumerParams(consumer),
        at,
        at
      );
      return { consumer, registeredAt: at, lastSeenAt: at, lastDeliveredAt: null };
    }),
    touch: (consumer, at, delivered) => {
      conn.run(
        `UPDATE consumers SET last_seen_at = ?,
           last_delivered_at = CASE WHEN ? THEN ? ELSE last_delivered_at END
         WHERE ${WHERE_CONSUMER}`,
        at,
        delivered ? 1 : 0,
        at,
        ...consumerParams(consumer)
      );
    },
    unregister,
    expire: (cutoff) => conn.transaction(() => {
      const expired = idleSince(cutoff).map((record) => record.consumer);
      for (const consumer of expired) unregister(consumer);
      return expired;
    }),
    idleSince
  };
}
function toConsumer(row) {
  return {
    consumer: {
      worktreeId: str(row, "worktree_id"),
      sessionId: str(row, "session_id"),
      agentId: str(row, "agent_id")
    },
    registeredAt: num(row, "registered_at"),
    lastSeenAt: num(row, "last_seen_at"),
    lastDeliveredAt: numOrNull(row, "last_delivered_at")
  };
}
function createViewRepo(conn) {
  return {
    list: (consumer) => conn.all(
      `SELECT v.*, ${CHECK_COLUMNS} FROM consumer_views v JOIN checks c ON c.id = v.check_id
           WHERE v.worktree_id = ? AND v.session_id = ? AND v.agent_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      ...consumerParams(consumer)
    ).map(toView),
    writeMany: (consumer, entries) => conn.transaction(() => {
      for (const e of entries) {
        conn.run(
          `INSERT OR REPLACE INTO consumer_views
               (worktree_id, session_id, agent_id, check_id, outcome, fingerprint, told_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          ...consumerParams(consumer),
          ensureCheckId(conn, e.check, e.toldAt),
          e.outcome,
          e.fingerprint,
          e.toldAt
        );
      }
    }),
    removeMany: (consumer, checks) => conn.transaction(() => {
      for (const check of checks) {
        const id = findCheckId(conn, check);
        if (id === null) continue;
        conn.run(
          `DELETE FROM consumer_views WHERE ${WHERE_CONSUMER} AND check_id = ?`,
          ...consumerParams(consumer),
          id
        );
      }
    })
  };
}
function toView(row) {
  return {
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES),
    fingerprint: strOrNull(row, "fingerprint"),
    toldAt: num(row, "told_at")
  };
}
var OUTCOMES, WHERE_CONSUMER;
var init_consumers = __esm({
  "src/core/store/repos/consumers.ts"() {
    "use strict";
    init_codec();
    OUTCOMES = ["pass", "fail", "skip", "unknown"];
    WHERE_CONSUMER = "worktree_id = ? AND session_id = ? AND agent_id = ?";
  }
});

// src/core/store/repos/results.ts
import { createHash as createHash4 } from "node:crypto";
function createResultRepo(conn) {
  return {
    byKey: (key, usedAt = Date.now()) => {
      conn.run(
        "UPDATE results SET last_used_at = ? WHERE key = ? AND last_used_at < ?",
        usedAt,
        key,
        usedAt
      );
      return conn.all(
        `${SELECT_RESULTS} WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
        key
      ).map(toResult);
    },
    checksForKey: (key) => conn.all(
      `SELECT ${CHECK_COLUMNS} FROM results r JOIN checks c ON c.id = r.check_id
           WHERE r.key = ? ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      key
    ).map(checkFrom),
    latestForCheck: (check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_RESULTS} WHERE r.check_id = ? ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT 1`,
        id
      );
      return row === null ? null : toResult(row);
    },
    listForCheck: (check, limit) => {
      const id = findCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `${SELECT_RESULTS} WHERE r.check_id = ?
           ORDER BY r.recorded_at DESC, r.rowid DESC LIMIT ?`,
        id,
        limit
      ).map(toResult);
    },
    putMany: (records) => conn.transaction(() => {
      for (const r of records) {
        const p = r.provenance;
        conn.run(
          `INSERT OR REPLACE INTO results (check_id, key, outcome, duration_ms, location_path,
               location_line, location_column, fingerprint, failure_id, worktree_id, revision,
               commit_sha, dirty, run_id, recorded_at, last_used_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ensureCheckId(conn, r.check, p.recordedAt),
          r.key,
          r.outcome,
          r.durationMs,
          ...locationParams(r.location),
          r.fingerprint,
          storeFailureText(conn, r.summary, r.errors),
          p.worktreeId,
          p.revision,
          p.commit,
          flag(p.dirty),
          p.runId,
          p.recordedAt,
          p.recordedAt
        );
      }
    })
  };
}
function storeFailureText(conn, summary, errors) {
  if (summary === null && errors.length === 0) return null;
  const text = JSON.stringify(errors);
  const id = createHash4("sha256").update(JSON.stringify([summary, text])).digest("hex");
  conn.run(
    "INSERT INTO failure_texts (id, summary, errors) VALUES (?, ?, ?) ON CONFLICT DO NOTHING",
    id,
    summary,
    text
  );
  return id;
}
function toResult(row) {
  return {
    check: checkFrom(row),
    key: str(row, "key"),
    outcome: oneOf(row, "outcome", OUTCOMES2),
    durationMs: num(row, "duration_ms"),
    location: location(row),
    fingerprint: strOrNull(row, "fingerprint"),
    summary: strOrNull(row, "summary"),
    errors: row.errors === null ? [] : json(row, "errors"),
    provenance: {
      worktreeId: str(row, "worktree_id"),
      revision: num(row, "revision"),
      commit: strOrNull(row, "commit_sha"),
      dirty: bool(row, "dirty"),
      runId: str(row, "run_id"),
      recordedAt: num(row, "recorded_at")
    }
  };
}
var OUTCOMES2, SELECT_RESULTS;
var init_results = __esm({
  "src/core/store/repos/results.ts"() {
    "use strict";
    init_codec();
    OUTCOMES2 = ["pass", "fail", "skip"];
    SELECT_RESULTS = `
  SELECT r.*, ${CHECK_COLUMNS}, f.summary, f.errors
  FROM results r
  JOIN checks c ON c.id = r.check_id
  LEFT JOIN failure_texts f ON f.id = r.failure_id`;
  }
});

// src/core/store/repos/runs.ts
function createRunRepo(conn) {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO runs (id, worktree_id, revision, test_files, checkpoint_id, log_dir, started_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        JSON.stringify(record.testFiles),
        record.checkpointId,
        record.logDir,
        record.startedAt
      );
      return { ...record, endedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE runs SET end_state = ?, ended_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM runs WHERE id = ?", id);
      return row === null ? null : toRun(row);
    }
  };
}
function toRun(row) {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    testFiles: json(row, "test_files"),
    checkpointId: strOrNull(row, "checkpoint_id"),
    logDir: str(row, "log_dir"),
    startedAt: num(row, "started_at"),
    endedAt: numOrNull(row, "ended_at"),
    end: oneOfOrNull(row, "end_state", RUN_ENDS)
  };
}
function createCheckpointRepo(conn) {
  return {
    start: (record) => {
      conn.run(
        `INSERT INTO checkpoints (id, worktree_id, revision, kind, test_files, started_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        record.id,
        record.worktreeId,
        record.revision,
        record.kind,
        JSON.stringify(record.testFiles),
        record.startedAt
      );
      return { ...record, completedAt: null, end: null };
    },
    finish: (id, end, at) => {
      conn.run("UPDATE checkpoints SET end_state = ?, completed_at = ? WHERE id = ?", end, at, id);
    },
    get: (id) => {
      const row = conn.get("SELECT * FROM checkpoints WHERE id = ?", id);
      return row === null ? null : toCheckpoint(row);
    },
    lastCompleted: (worktreeId) => {
      const row = conn.get(
        `SELECT * FROM checkpoints WHERE worktree_id = ? AND end_state = 'completed'
         ORDER BY completed_at DESC, rowid DESC LIMIT 1`,
        worktreeId
      );
      return row === null ? null : toCheckpoint(row);
    }
  };
}
function toCheckpoint(row) {
  return {
    id: str(row, "id"),
    worktreeId: str(row, "worktree_id"),
    revision: num(row, "revision"),
    kind: oneOf(row, "kind", CHECKPOINT_KINDS),
    testFiles: json(row, "test_files"),
    startedAt: num(row, "started_at"),
    completedAt: numOrNull(row, "completed_at"),
    end: oneOfOrNull(row, "end_state", CHECKPOINT_ENDS)
  };
}
var RUN_ENDS, CHECKPOINT_KINDS, CHECKPOINT_ENDS;
var init_runs = __esm({
  "src/core/store/repos/runs.ts"() {
    "use strict";
    init_codec();
    RUN_ENDS = ["completed", "crashed", "timed-out"];
    CHECKPOINT_KINDS = ["run-all", "baseline"];
    CHECKPOINT_ENDS = ["completed", "abandoned"];
  }
});

// src/core/store/repos/states.ts
function createKnownStateRepo(conn) {
  return {
    list: (worktreeId) => conn.all(
      `${SELECT_STATES} WHERE s.worktree_id = ?
           ORDER BY c.project, c.test_path, c.kind, c.full_name`,
      worktreeId
    ).map(toKnownState),
    get: (worktreeId, check) => {
      const id = findCheckId(conn, check);
      if (id === null) return null;
      const row = conn.get(
        `${SELECT_STATES} WHERE s.worktree_id = ? AND s.check_id = ?`,
        worktreeId,
        id
      );
      return row === null ? null : toKnownState(row);
    },
    upsertMany: (states) => conn.transaction(() => {
      const now = Date.now();
      for (const s of states) {
        const origin = s.origin;
        conn.run(
          `INSERT OR REPLACE INTO known_states (worktree_id, check_id, outcome, validity,
               pending_phase, observed_at, commit_sha, origin_kind, origin_worktree,
               origin_commit, duration_ms, location_path, location_line, location_column,
               summary, fingerprint)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          s.worktreeId,
          ensureCheckId(conn, s.check, now),
          s.outcome,
          s.validity,
          s.pendingPhase,
          s.observedAt,
          s.commit,
          origin?.kind ?? null,
          origin?.kind === "inherited" ? origin.worktreeId : null,
          origin?.kind === "inherited" ? origin.commit : null,
          s.durationMs,
          ...locationParams(s.location),
          s.summary,
          s.fingerprint
        );
      }
    }),
    removeMany: (worktreeId, checks) => conn.transaction(() => {
      for (const check of checks) {
        const id = findCheckId(conn, check);
        if (id === null) continue;
        conn.run(
          "DELETE FROM known_states WHERE worktree_id = ? AND check_id = ?",
          worktreeId,
          id
        );
      }
    })
  };
}
function toOrigin(row) {
  const kind = oneOfOrNull(row, "origin_kind", ["own", "inherited"]);
  if (kind === null) return null;
  if (kind === "own") return { kind };
  return {
    kind,
    worktreeId: str(row, "origin_worktree"),
    commit: strOrNull(row, "origin_commit")
  };
}
function toKnownState(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    outcome: oneOf(row, "outcome", OUTCOMES3),
    validity: oneOf(row, "validity", VALIDITIES),
    pendingPhase: oneOfOrNull(row, "pending_phase", PENDING),
    observedAt: numOrNull(row, "observed_at"),
    commit: strOrNull(row, "commit_sha"),
    origin: toOrigin(row),
    durationMs: numOrNull(row, "duration_ms"),
    location: location(row),
    summary: strOrNull(row, "summary"),
    fingerprint: strOrNull(row, "fingerprint")
  };
}
function createTransitionRepo(conn) {
  return {
    append: (transitions) => conn.transaction(() => {
      for (const t of transitions) {
        conn.run(
          `INSERT INTO transitions (worktree_id, check_id, kind, from_outcome, to_outcome,
               from_fingerprint, to_fingerprint, revision, at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          t.worktreeId,
          ensureCheckId(conn, t.check, t.at),
          t.kind,
          t.from,
          t.to,
          t.fromFingerprint,
          t.toFingerprint,
          t.revision,
          t.at
        );
      }
    }),
    history: (worktreeId, check) => {
      const id = findCheckId(conn, check);
      if (id === null) return [];
      return conn.all(
        `SELECT t.*, ${CHECK_COLUMNS} FROM transitions t JOIN checks c ON c.id = t.check_id
           WHERE t.worktree_id = ? AND t.check_id = ? ORDER BY t.id`,
        worktreeId,
        id
      ).map(toTransition);
    }
  };
}
function toTransition(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    check: checkFrom(row),
    kind: oneOf(row, "kind", KINDS),
    from: oneOfOrNull(row, "from_outcome", OUTCOMES3),
    to: oneOf(row, "to_outcome", OUTCOMES3),
    fromFingerprint: strOrNull(row, "from_fingerprint"),
    toFingerprint: strOrNull(row, "to_fingerprint"),
    revision: num(row, "revision"),
    at: num(row, "at")
  };
}
var OUTCOMES3, VALIDITIES, PENDING, KINDS, SELECT_STATES;
var init_states = __esm({
  "src/core/store/repos/states.ts"() {
    "use strict";
    init_codec();
    OUTCOMES3 = ["pass", "fail", "skip", "unknown"];
    VALIDITIES = ["current", "pending", "stale", "unknown"];
    PENDING = ["queued", "running"];
    KINDS = [
      "first-seen-fail",
      "pass-to-fail",
      "fail-to-pass",
      "fail-changed",
      "to-unknown"
    ];
    SELECT_STATES = `SELECT s.*, ${CHECK_COLUMNS} FROM known_states s JOIN checks c ON c.id = s.check_id`;
  }
});

// src/core/store/repos/test-files.ts
function createTestFileRepo(conn) {
  return {
    get: (testFile) => {
      const row = conn.get(
        "SELECT * FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path
      );
      return row === null ? null : toTestFile(row);
    },
    list: () => conn.all("SELECT * FROM test_files ORDER BY project, path").map(toTestFile),
    put: (record) => {
      conn.run(
        `INSERT OR REPLACE INTO test_files
           (project, path, closure_paths, complete, method, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        record.testFile.project,
        record.testFile.path,
        JSON.stringify(record.closure.paths),
        flag(record.closure.complete),
        record.closure.method,
        record.updatedAt,
        record.updatedBy
      );
    },
    remove: (testFile) => {
      conn.run(
        "DELETE FROM test_files WHERE project = ? AND path = ?",
        testFile.project,
        testFile.path
      );
    }
  };
}
function toTestFile(row) {
  const testFile = { project: str(row, "project"), path: str(row, "path") };
  return {
    testFile,
    closure: {
      testFile,
      paths: json(row, "closure_paths"),
      complete: bool(row, "complete"),
      method: oneOf(row, "method", METHODS)
    },
    updatedAt: num(row, "updated_at"),
    updatedBy: str(row, "updated_by")
  };
}
function createTestFileKeyRepo(conn) {
  return {
    list: (worktreeId) => conn.all(
      "SELECT * FROM test_file_keys WHERE worktree_id = ? ORDER BY project, path",
      worktreeId
    ).map(toTestFileKey),
    upsertMany: (records) => conn.transaction(() => {
      for (const r of records) {
        conn.run(
          `INSERT OR REPLACE INTO test_file_keys
               (worktree_id, project, path, key, revision, pending)
             VALUES (?, ?, ?, ?, ?, ?)`,
          r.worktreeId,
          r.testFile.project,
          r.testFile.path,
          r.key,
          r.revision,
          r.pending
        );
      }
    }),
    remove: (worktreeId, testFiles) => conn.transaction(() => {
      for (const t of testFiles) {
        conn.run(
          "DELETE FROM test_file_keys WHERE worktree_id = ? AND project = ? AND path = ?",
          worktreeId,
          t.project,
          t.path
        );
      }
    })
  };
}
function toTestFileKey(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    testFile: { project: str(row, "project"), path: str(row, "path") },
    key: strOrNull(row, "key"),
    revision: num(row, "revision"),
    pending: oneOfOrNull(row, "pending", PENDING2)
  };
}
function createCheckRepo(conn) {
  return {
    listByTestFile: (testFile) => conn.all(
      `SELECT c.*, ${CHECK_COLUMNS} FROM checks c WHERE c.project = ? AND c.test_path = ?
           ORDER BY c.kind, c.full_name`,
      testFile.project,
      testFile.path
    ).map(toCheck),
    upsertMany: (records) => conn.transaction(() => {
      for (const r of records) {
        const id = ensureCheckId(conn, r.check, r.firstSeenAt);
        conn.run(
          `UPDATE checks SET location_path = ?, location_line = ?, location_column = ?,
               templated = ? WHERE id = ?`,
          ...locationParams(r.location),
          flag(r.templated),
          id
        );
      }
    })
  };
}
function toCheck(row) {
  return {
    check: checkFrom(row),
    location: location(row),
    templated: bool(row, "templated"),
    firstSeenAt: num(row, "first_seen_at")
  };
}
var METHODS, PENDING2;
var init_test_files = __esm({
  "src/core/store/repos/test-files.ts"() {
    "use strict";
    init_codec();
    METHODS = ["static imports plus declared inputs"];
    PENDING2 = ["queued", "running"];
  }
});

// src/core/store/repos/workspace.ts
function createRevisionRepo(conn) {
  return {
    append: (revision) => conn.transaction(() => {
      const row = conn.get(
        "SELECT coalesce(max(number), 0) AS n FROM revisions WHERE worktree_id = ?",
        revision.worktreeId
      );
      const stored = { ...revision, number: (row === null ? 0 : num(row, "n")) + 1 };
      conn.run(
        `INSERT INTO revisions (worktree_id, number, created_at, head, dirty, trigger, changes)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        stored.worktreeId,
        stored.number,
        stored.createdAt,
        stored.head,
        flag(stored.dirty),
        stored.trigger,
        JSON.stringify(stored.changes)
      );
      return stored;
    }),
    latest: (worktreeId) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? ORDER BY number DESC LIMIT 1",
        worktreeId
      );
      return row === null ? null : toRevision(row);
    },
    get: (worktreeId, number) => {
      const row = conn.get(
        "SELECT * FROM revisions WHERE worktree_id = ? AND number = ?",
        worktreeId,
        number
      );
      return row === null ? null : toRevision(row);
    }
  };
}
function toRevision(row) {
  return {
    worktreeId: str(row, "worktree_id"),
    number: num(row, "number"),
    createdAt: num(row, "created_at"),
    head: strOrNull(row, "head"),
    dirty: bool(row, "dirty"),
    trigger: oneOf(row, "trigger", TRIGGERS),
    changes: json(row, "changes")
  };
}
function createFileHashRepo(conn) {
  return {
    get: (worktreeId, path) => {
      const row = conn.get(
        "SELECT * FROM file_hashes WHERE worktree_id = ? AND path = ?",
        worktreeId,
        path
      );
      return row === null ? null : toFileHash(row);
    },
    list: (worktreeId) => conn.all("SELECT * FROM file_hashes WHERE worktree_id = ? ORDER BY path", worktreeId).map(toFileHash),
    upsertMany: (worktreeId, records) => conn.transaction(() => {
      for (const r of records) {
        conn.run(
          `INSERT OR REPLACE INTO file_hashes
               (worktree_id, path, mtime_ms, ctime_ms, size, inode, hash)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
          worktreeId,
          r.path,
          r.mtimeMs,
          r.ctimeMs,
          r.size,
          r.inode,
          r.hash
        );
      }
    }),
    removeMany: (worktreeId, paths) => conn.transaction(() => {
      for (const path of paths) {
        conn.run("DELETE FROM file_hashes WHERE worktree_id = ? AND path = ?", worktreeId, path);
      }
    })
  };
}
function toFileHash(row) {
  return {
    path: str(row, "path"),
    mtimeMs: num(row, "mtime_ms"),
    ctimeMs: num(row, "ctime_ms"),
    size: num(row, "size"),
    inode: num(row, "inode"),
    hash: str(row, "hash")
  };
}
var TRIGGERS;
var init_workspace = __esm({
  "src/core/store/repos/workspace.ts"() {
    "use strict";
    init_codec();
    TRIGGERS = ["watch", "interval", "start", "dropped-events"];
  }
});

// src/core/store/repos/worktrees.ts
function createWorktreeRepo(conn) {
  return {
    get: (id) => {
      const row = conn.get("SELECT * FROM worktrees WHERE id = ?", id);
      return row === null ? null : toRecord(row);
    },
    list: () => conn.all("SELECT * FROM worktrees ORDER BY id").map(toRecord),
    upsert: (record) => {
      const d = record.daemon;
      conn.run(
        `INSERT INTO worktrees (id, root, common_dir, is_main, registered_at, daemon_socket,
           daemon_started_at, daemon_heartbeat_at, daemon_heartbeat_interval_ms, daemon_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET root = excluded.root, common_dir = excluded.common_dir,
           is_main = excluded.is_main, registered_at = excluded.registered_at,
           daemon_socket = excluded.daemon_socket, daemon_started_at = excluded.daemon_started_at,
           daemon_heartbeat_at = excluded.daemon_heartbeat_at,
           daemon_heartbeat_interval_ms = excluded.daemon_heartbeat_interval_ms,
           daemon_version = excluded.daemon_version`,
        record.id,
        record.root,
        record.commonDir,
        flag(record.isMain),
        record.registeredAt,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? record.lastHeartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null
      );
    },
    // Clearing keeps `daemon_heartbeat_at`: the last heartbeat (review wave 4.5, N5).
    setDaemon: (id, d) => {
      conn.run(
        `UPDATE worktrees SET daemon_socket = ?, daemon_started_at = ?,
           daemon_heartbeat_at = COALESCE(?, daemon_heartbeat_at),
           daemon_heartbeat_interval_ms = ?, daemon_version = ? WHERE id = ?`,
        d?.socketPath ?? null,
        d?.startedAt ?? null,
        d?.heartbeatAt ?? null,
        d?.heartbeatIntervalMs ?? null,
        d?.squealVersion ?? null,
        id
      );
    },
    heartbeat: (id, at) => {
      conn.run(
        "UPDATE worktrees SET daemon_heartbeat_at = ? WHERE id = ? AND daemon_socket IS NOT NULL",
        at,
        id
      );
    },
    remove: (id) => {
      conn.transaction(() => {
        conn.run("DELETE FROM worktrees WHERE id = ?", id);
        for (const table of WORKTREE_SCOPED_TABLES) {
          conn.run(`DELETE FROM ${table} WHERE worktree_id = ?`, id);
        }
      });
    }
  };
}
function toRecord(row) {
  const socketPath = strOrNull(row, "daemon_socket");
  const lastHeartbeatAt = numOrNull(row, "daemon_heartbeat_at");
  return {
    id: str(row, "id"),
    root: str(row, "root"),
    commonDir: str(row, "common_dir"),
    isMain: bool(row, "is_main"),
    registeredAt: num(row, "registered_at"),
    daemon: socketPath === null ? null : {
      socketPath,
      startedAt: num(row, "daemon_started_at"),
      heartbeatAt: num(row, "daemon_heartbeat_at"),
      heartbeatIntervalMs: num(row, "daemon_heartbeat_interval_ms"),
      squealVersion: str(row, "daemon_version")
    },
    ...socketPath === null && lastHeartbeatAt !== null ? { lastHeartbeatAt } : {}
  };
}
var WORKTREE_SCOPED_TABLES;
var init_worktrees = __esm({
  "src/core/store/repos/worktrees.ts"() {
    "use strict";
    init_codec();
    WORKTREE_SCOPED_TABLES = [
      "revisions",
      "file_hashes",
      "test_file_keys",
      "known_states",
      "transitions",
      "consumer_views",
      "consumers"
    ];
  }
});

// src/core/store/store.ts
function createStore(conn, schemaVersion, paths) {
  const worktrees = createWorktreeRepo(conn);
  const store = {
    schemaVersion,
    worktrees,
    revisions: createRevisionRepo(conn),
    fileHashes: createFileHashRepo(conn),
    testFiles: createTestFileRepo(conn),
    testFileKeys: createTestFileKeyRepo(conn),
    checks: createCheckRepo(conn),
    results: createResultRepo(conn),
    runs: createRunRepo(conn),
    checkpoints: createCheckpointRepo(conn),
    knownStates: createKnownStateRepo(conn),
    transitions: createTransitionRepo(conn),
    consumers: createConsumerRepo(conn),
    views: createViewRepo(conn),
    meta: createMetaRepo(conn),
    transaction: (fn) => conn.transaction(fn),
    prune: (options) => prune(conn, worktrees, paths, options),
    close: () => conn.close()
  };
  connections.set(store, conn);
  return store;
}
function createMetaRepo(conn) {
  return {
    get: (key) => {
      const row = conn.get("SELECT value FROM meta WHERE key = ?", key);
      return row === null ? null : str(row, "value");
    },
    set: (key, value) => {
      conn.run("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)", key, value);
    }
  };
}
var connections;
var init_store = __esm({
  "src/core/store/store.ts"() {
    "use strict";
    init_codec();
    init_prune();
    init_consumers();
    init_results();
    init_runs();
    init_states();
    init_test_files();
    init_workspace();
    init_worktrees();
    connections = /* @__PURE__ */ new WeakMap();
  }
});

// src/core/store/open.ts
import { existsSync as existsSync3, mkdirSync, renameSync, rmSync as rmSync2 } from "node:fs";
import { join as join7 } from "node:path";
import { DatabaseSync } from "node:sqlite";
function isStoreOpenFailure(value) {
  return "reason" in value;
}
function openStore(commonDir, options = {}) {
  const paths = storePaths(commonDir);
  if (!existsSync3(paths.database)) {
    if (options.create === false) return { reason: "missing" };
    mkdirSync(paths.dir, { recursive: true });
  }
  const opened = connect(paths, options);
  if (!("corrupt" in opened)) return opened;
  if (options.checkIntegrity !== true) return { reason: "corrupt", movedTo: null };
  return recover(paths, options);
}
function connect(paths, options) {
  let db;
  try {
    db = new DatabaseSync(paths.database);
    db.exec(`PRAGMA busy_timeout = ${busyTimeout(options)}`);
    const found = userVersion(db);
    if (found > SCHEMA_VERSION) {
      db.close();
      return { reason: "newer-schema", found, supported: SCHEMA_VERSION };
    }
    if (options.checkIntegrity === true) {
      const problem = integrityProblem(db);
      if (problem !== null) {
        db.close();
        return { corrupt: problem };
      }
    }
    db.exec("PRAGMA auto_vacuum = INCREMENTAL");
    const mode = db.prepare("PRAGMA journal_mode = WAL").get()?.journal_mode;
    if (mode !== "wal") throw new Error(`squeal store: journal_mode is ${String(mode)}, not wal`);
    db.exec("PRAGMA synchronous = NORMAL");
    const version = migrate(db);
    return createStore(new Connection(db), version, paths);
  } catch (error) {
    db?.close();
    if (isCorruption(error)) return { corrupt: String(error) };
    throw error;
  }
}
function busyTimeout(options) {
  const ms = options.busyTimeoutMs ?? DEFAULT_BUSY_TIMEOUT_MS;
  if (!Number.isInteger(ms) || ms < 0) throw new RangeError(`busyTimeoutMs must be >= 0: ${ms}`);
  return ms;
}
function integrityProblem(db) {
  const rows = db.prepare("PRAGMA integrity_check").all();
  const messages = rows.map((row) => String(row.integrity_check));
  return messages.length === 1 && messages[0] === "ok" ? null : messages.join("; ");
}
function isCorruption(error) {
  const code = error.errcode;
  return typeof code === "number" && [11, 26].includes(code & 255);
}
function recover(paths, options) {
  mkdirSync(paths.locksDir, { recursive: true });
  const lock2 = new DatabaseSync(join7(paths.locksDir, "store-recovery.sqlite"));
  try {
    lock2.exec(`PRAGMA busy_timeout = ${Math.max(busyTimeout(options), 1e4)}`);
    lock2.exec("BEGIN EXCLUSIVE");
    const again = connect(paths, { ...options, checkIntegrity: true });
    if (!("corrupt" in again)) return again;
    const now = options.now ?? Date.now;
    const at = now();
    const movedTo = moveAside(paths.database, at);
    const fresh = connect(paths, { ...options, checkIntegrity: false });
    if ("corrupt" in fresh) return { reason: "corrupt", movedTo };
    if (!isStoreOpenFailure(fresh)) {
      const note = JSON.stringify({ at, movedTo, reason: again.corrupt });
      fresh.transaction(() => fresh.meta.set(META_STORE_RECOVERED, note));
    }
    return fresh;
  } finally {
    rollback(lock2);
    lock2.close();
  }
}
function moveAside(database, at) {
  let movedTo = `${database}.corrupt-${at}`;
  for (let n = 1; existsSync3(movedTo); n++) movedTo = `${database}.corrupt-${at}-${n}`;
  renameSync(database, movedTo);
  if (existsSync3(`${database}-wal`)) renameSync(`${database}-wal`, `${movedTo}-wal`);
  rmSync2(`${database}-shm`, { force: true });
  return movedTo;
}
var DEFAULT_BUSY_TIMEOUT_MS, META_STORE_RECOVERED;
var init_open = __esm({
  "src/core/store/open.ts"() {
    "use strict";
    init_connection();
    init_paths2();
    init_schema();
    init_store();
    DEFAULT_BUSY_TIMEOUT_MS = 1e3;
    META_STORE_RECOVERED = "store.recovered";
  }
});

// src/core/store/index.ts
var store_exports = {};
__export(store_exports, {
  DEFAULT_BUSY_TIMEOUT_MS: () => DEFAULT_BUSY_TIMEOUT_MS,
  META_STORE_RECOVERED: () => META_STORE_RECOVERED,
  SCHEMA_VERSION: () => SCHEMA_VERSION,
  isStoreOpenFailure: () => isStoreOpenFailure,
  lockFileFor: () => lockFileFor,
  openStore: () => openStore,
  resolveCommonDir: () => resolveCommonDir,
  storePaths: () => storePaths,
  worktreeIdFor: () => worktreeIdFor
});
var init_store2 = __esm({
  "src/core/store/index.ts"() {
    "use strict";
    init_open();
    init_paths2();
    init_schema();
  }
});

// src/core/notes.ts
import { stripVTControlCharacters } from "node:util";
function appendNote(store, worktreeId, note) {
  const key = notesMetaKey(worktreeId);
  const plain = { ...note, text: stripVTControlCharacters(note.text) };
  store.transaction(() => {
    store.meta.set(key, JSON.stringify(withNote(store.meta.get(key), plain)));
  });
}
function withNote(raw, note) {
  return [...parseList(raw), note].slice(-MAX_PERSISTED_NOTES);
}
function readDaemonNotes(store, worktreeId) {
  return parseList(store.meta.get(notesMetaKey(worktreeId))).flatMap(toNote).slice(-MAX_PERSISTED_NOTES);
}
function parseList(raw) {
  if (typeof raw !== "string") return [];
  try {
    const value = JSON.parse(raw);
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}
function toNote(item) {
  if (typeof item !== "object" || item === null) return [];
  const { at, revision, text } = item;
  if (typeof at !== "number" || typeof text !== "string") return [];
  if (revision !== null && typeof revision !== "number") return [];
  return [{ at, revision, text }];
}
var init_notes = __esm({
  "src/core/notes.ts"() {
    "use strict";
    init_types();
  }
});

// src/core/daemon/policy.ts
import { readFileSync as readFileSync5 } from "node:fs";
import { join as join13 } from "node:path";
function loadPolicy(root) {
  let text;
  try {
    text = readFileSync5(join13(root, POLICY_FILE), "utf8");
  } catch (error) {
    if (isMissing(error)) return { policy: DEFAULT_POLICY, problems: [] };
    return defaultsBecause(`could not be read: ${String(error)}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return defaultsBecause(`not valid JSON (${error.message})`);
  }
  if (!isObject(parsed)) {
    return defaultsBecause(
      `must be a JSON object, got ${Array.isArray(parsed) ? "an array" : JSON.stringify(parsed)}`
    );
  }
  const problems = [];
  const merged = merge(SHAPE, DEFAULT_POLICY, parsed, "", problems);
  return { policy: merged, problems };
}
function defaultsBecause(problem) {
  return { policy: DEFAULT_POLICY, problems: [problem] };
}
function merge(shape, defaults, given, prefix, problems) {
  const result = { ...defaults };
  for (const [key, value] of Object.entries(given)) {
    const path = `${prefix}${key}`;
    const rule = Object.hasOwn(shape, key) ? shape[key] : void 0;
    if (rule === void 0) {
      problems.push(`unknown key "${path}"`);
    } else if (typeof rule === "function") {
      const expected = rule(value);
      if (expected === null) result[key] = value;
      else if (typeof expected === "object") problems.push(`"${path}" ${expected.problem}`);
      else problems.push(`"${path}" must be ${expected}, got ${JSON.stringify(value)}`);
    } else if (!isObject(value)) {
      problems.push(`"${path}" must be an object, got ${JSON.stringify(value)}`);
    } else {
      const nested = defaults[key] ?? {};
      result[key] = merge(rule, nested, value, `${path}.`, problems);
    }
  }
  return result;
}
function isObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}
function describeProblems(problems) {
  return `${problems.join("; ")}; the defaults apply in their place`;
}
function lastPolicyNote(store, worktreeId) {
  const texts = readDaemonNotes(store, worktreeId).map((note) => note.text);
  return texts.findLast((text) => text.startsWith(POLICY_FILE)) ?? null;
}
var POLICY_FILE, boolean, strings, inputs, atLeastZero, aboveZero, positiveInteger, orNull, oneOf2, SHAPE;
var init_policy2 = __esm({
  "src/core/daemon/policy.ts"() {
    "use strict";
    init_fs();
    init_glob();
    init_notes();
    init_types();
    POLICY_FILE = "squeal.config.json";
    boolean = (v) => typeof v === "boolean" ? null : "true or false";
    strings = (v) => Array.isArray(v) && v.every((s) => typeof s === "string") ? null : "an array of strings";
    inputs = (v) => {
      const isList = strings(v) === null;
      if (!isList && !(isObject(v) && Object.values(v).every((globs2) => strings(globs2) === null))) {
        return "an array of strings, or an object from test-file glob to an array of strings";
      }
      const globs = isList ? v : Object.entries(v).flatMap(([test, input]) => [test, ...input]);
      for (const glob of globs) {
        try {
          globToRegExp(glob);
        } catch (error) {
          return { problem: `has a glob Squeal cannot use: ${error.message}` };
        }
      }
      return null;
    };
    atLeastZero = (v) => isNumber(v) && v >= 0 ? null : "a number >= 0";
    aboveZero = (v) => isNumber(v) && v > 0 ? null : "a number > 0";
    positiveInteger = (v) => Number.isInteger(v) && v > 0 ? null : "a positive integer";
    orNull = (leaf) => (v) => {
      const expected = v === null ? null : leaf(v);
      return expected === null || typeof expected === "object" ? expected : `${expected}, or null`;
    };
    oneOf2 = (...values) => (v) => values.includes(v) ? null : `one of ${values.map((s) => `"${s}"`).join(", ")}`;
    SHAPE = {
      interrupt: { onRegression: boolean },
      stop: { blockOnKnownFailures: boolean, requireFullSuite: boolean, waitMs: atLeastZero },
      baseline: { onStart: oneOf2("lookup-then-run-missing", "lookup-only") },
      inputs,
      env: { allowlist: strings },
      runner: {
        tierSize: positiveInteger,
        timeoutMs: orNull(positiveInteger),
        maxConcurrentRuns: positiveInteger
      },
      daemon: { idleExitMinutes: aboveZero },
      store: { retentionDays: atLeastZero, maxSizeMb: orNull(aboveZero) }
    };
  }
});

// src/core/scheduler/files.ts
function newFileState(ref) {
  return {
    ref,
    id: testFileId(ref),
    key: null,
    resultKey: null,
    checks: [],
    failing: false,
    durationMs: null,
    phase: null,
    runningKey: null,
    unknownKey: null,
    discards: 0,
    blocked: null
  };
}
function classify2(file) {
  if (file.phase !== null) return "pending";
  if (file.key === null || file.blocked !== null) return "unknown";
  if (file.unknownKey === file.key) return "unknown";
  if (file.resultKey === file.key) return "current";
  return file.resultKey === null ? "unknown" : "stale";
}
function checkId(check) {
  const name = check.kind === "test" ? check.fullName : "";
  return `${check.kind}\0${check.project}\0${check.testPath}\0${name}`;
}
function durationOf(results2) {
  if (results2.length === 0) return null;
  return results2.reduce((sum, result) => sum + result.durationMs, 0);
}
var init_files = __esm({
  "src/core/scheduler/files.ts"() {
    "use strict";
    init_keys();
  }
});

// src/core/scheduler/context.ts
async function tryRunner(context, subject, call, onFailure) {
  try {
    return await call();
  } catch (error) {
    const reason2 = `runner ${subject} failed: ${error instanceof Error ? error.message : String(error)}`;
    context.note(reason2);
    onFailure?.(reason2);
    return null;
  }
}
var NOTHING_CHANGED;
var init_context = __esm({
  "src/core/scheduler/context.ts"() {
    "use strict";
    NOTHING_CHANGED = /* @__PURE__ */ new Set();
  }
});

// src/core/scheduler/failures.ts
function failed(failures, project, reason2) {
  if (!failures.has(project)) failures.set(project, reason2);
}
function settleFailures(ledger, failures, retrying, changed) {
  if (failures.size > 0) block(ledger, failures);
  else if (retrying) ledger.settle(unblock(ledger), changed);
}
function block(ledger, failures) {
  const every = failures.get(null);
  const byReason = /* @__PURE__ */ new Map();
  for (const file of ledger.files.values()) {
    const reason2 = every ?? failures.get(file.ref.project);
    if (reason2 === void 0 || file.blocked !== null) continue;
    file.blocked = reason2;
    if (!ledger.queue.isForced(file.ref)) ledger.queue.remove(file.ref);
    const files = byReason.get(reason2);
    if (files) files.push(file);
    else byReason.set(reason2, [file]);
  }
  for (const [reason2, files] of byReason) {
    ledger.markUnknown(
      files.map((file) => ({ file, key: file.key })),
      reason2
    );
  }
  ledger.broken = true;
}
function unblock(ledger) {
  const refs = [];
  for (const file of ledger.files.values()) {
    if (file.blocked === null) continue;
    file.blocked = null;
    file.unknownKey = null;
    ledger.touch(file);
    refs.push(file.ref);
  }
  ledger.broken = false;
  return refs;
}
var init_failures = __esm({
  "src/core/scheduler/failures.ts"() {
    "use strict";
  }
});

// src/core/scheduler/notes.ts
function listPaths(paths, max = 5) {
  const shown = paths.slice(0, max).join(", ");
  return paths.length > max ? `${shown} and ${paths.length - max} more` : shown;
}
function unmatchedInputNotes(unmatched) {
  return [
    ...unmatched.testGlobs.map(
      (glob) => `${POLICY_FILE}: inputs key "${glob}" matches no test file; keys and input globs match worktree-relative paths from the start, so write "**/${glob}" for a file in any directory`
    ),
    ...unmatched.inputGlobs.map((glob) => `${POLICY_FILE}: inputs glob "${glob}" matches no file`)
  ];
}
function persistedNoteTexts(store, worktreeId) {
  return new Set(readDaemonNotes(store, worktreeId).map((note) => note.text));
}
var init_notes2 = __esm({
  "src/core/scheduler/notes.ts"() {
    "use strict";
    init_policy2();
    init_notes();
  }
});

// src/core/scheduler/revision.ts
function toInvalidatedPath(change) {
  const kind = change.oldHash === null ? "add" : change.newHash === null ? "delete" : "change";
  return { path: change.path, kind };
}
function rekeyContent(context, ledger, revision) {
  const { keys } = context;
  const changes = revision.changes;
  const touched = [];
  const policy = reloadPolicy(context, ledger, changes);
  touched.push(...policy.changes.map((c) => c.testFile));
  const rekeyed = keys.index.rekey(changes.map((c) => c.path)).map((c) => c.testFile);
  touched.push(...rekeyed);
  const declared = keys.updateDeclaredInputs(changes);
  if (declared !== null) touched.push(...declared.map((c) => c.testFile));
  const inputs2 = changes.some((c) => keys.isEnvironmentInput(c.path));
  if (inputs2) touched.push(...keys.provisionalEnvironments(changes).map((c) => c.testFile));
  ledger.settle(touched, new Set(changes.map((c) => c.path)));
  return { rekeyed, environment: inputs2 || policy.environment };
}
function reloadPolicy(context, ledger, changes) {
  const policy = context.reloadPolicy(changes);
  if (policy === null) return { changes: [], environment: false };
  context.policy = policy;
  const applied = context.keys.setPolicy(policy);
  const testFiles = [...ledger.files.values()].map((file) => file.ref.path);
  for (const text of unmatchedInputNotes(context.keys.unmatchedInputs(testFiles))) {
    context.note(text);
  }
  return applied;
}
async function retryRunner(context, ledger) {
  if (!ledger.broken) return;
  const failures = /* @__PURE__ */ new Map();
  const touched = (await readEnvironments(context, failures)).map((c) => c.testFile);
  const listed = await listTestFiles(context, ledger);
  const blocked = [...ledger.files.values()].filter((f) => f.blocked !== null).map((f) => f.ref);
  const refs = [...listed, ...blocked];
  touched.push(...(await resolveClosures(context, refs, failures)).map((c) => c.testFile), ...refs);
  ledger.settle(touched, NOTHING_CHANGED);
  settleFailures(ledger, failures, true, NOTHING_CHANGED);
}
async function readEnvironments(context, failures) {
  const environments = await tryRunner(
    context,
    "environment",
    () => context.runner.environment(),
    (reason2) => failed(failures, null, reason2)
  );
  return environments === null ? [] : context.keys.setEnvironments(environments);
}
async function listTestFiles(context, ledger) {
  const listed = await tryRunner(context, "testFiles", () => context.runner.testFiles());
  return applyListing(context, ledger, listed);
}
function applyListing(context, ledger, listed) {
  ledger.listingFailed = listed === null;
  if (listed === null) return [];
  const ids = new Set(listed.map(testFileId));
  for (const file of [...ledger.files.values()]) {
    if (!ids.has(file.id)) ledger.removeFile(file);
  }
  for (const ref of listed) {
    if (!ledger.file(ref)) ledger.addFile(ref);
  }
  return listed.filter((ref) => !context.keys.index.closure(ref));
}
async function resolveClosures(context, refs, failures) {
  const changes = [];
  const resolved = [];
  for (const ref of refs) {
    const keyChanges = await resolveClosure(
      context,
      ref,
      (reason2) => failed(failures, ref.project, reason2)
    );
    if (keyChanges === null) continue;
    changes.push(...keyChanges);
    resolved.push(ref);
  }
  changes.push(...await context.keys.trackUntracked());
  storeClosures(context, resolved);
  return changes;
}
async function resolveClosure(context, ref, onFailure) {
  const closure = await tryRunner(
    context,
    `closure of ${ref.path}`,
    () => context.runner.closure(ref),
    onFailure
  );
  return closure === null ? null : context.keys.setClosure(closure);
}
function storeClosures(context, refs) {
  const { store, keys } = context;
  store.transaction(() => {
    for (const ref of refs) {
      const closure = keys.index.closure(ref);
      if (!closure) continue;
      store.testFiles.put({
        testFile: ref,
        closure,
        updatedAt: context.now(),
        updatedBy: context.worktreeId
      });
    }
  });
}
var init_revision = __esm({
  "src/core/scheduler/revision.ts"() {
    "use strict";
    init_keys();
    init_context();
    init_failures();
    init_notes2();
  }
});

// src/core/hash/blob.ts
import { createHash as createHash7 } from "node:crypto";
import { constants } from "node:fs";
import { open, readlink } from "node:fs/promises";
function blobHash(bytes, format) {
  return createHash7(format).update(`blob ${bytes.byteLength}\0`).update(bytes).digest("hex");
}
async function hashFile(path, format) {
  for (let attempt = 0; ; attempt++) {
    let handle;
    try {
      handle = await open(path, OPEN_FLAGS);
    } catch (error) {
      if (isMissing(error)) return null;
      if (errorCode(error) !== "ELOOP") throw error;
      const target = await readlinkOrNull(path, attempt > 0);
      if (target === void 0) continue;
      return target === null ? null : blobHash(target, format);
    }
    try {
      if (!(await handle.stat()).isFile()) return null;
      return blobHash(await handle.readFile(), format);
    } finally {
      await handle.close();
    }
  }
}
async function readlinkOrNull(path, last) {
  try {
    return await readlink(path, { encoding: "buffer" });
  } catch (error) {
    if (isMissing(error)) return null;
    if (errorCode(error) === "EINVAL" && !last) return void 0;
    throw error;
  }
}
function errorCode(error) {
  return error?.code;
}
var OPEN_FLAGS;
var init_blob = __esm({
  "src/core/hash/blob.ts"() {
    "use strict";
    init_fs();
    OPEN_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
  }
});

// src/core/hash/concurrency.ts
async function mapConcurrent(items, fn, limit = FILE_CONCURRENCY) {
  const results2 = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results2[index] = await fn(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results2;
}
var FILE_CONCURRENCY;
var init_concurrency = __esm({
  "src/core/hash/concurrency.ts"() {
    "use strict";
    FILE_CONCURRENCY = 64;
  }
});

// src/core/hash/git-index.ts
async function readObjectFormat(root) {
  const format = (await runGit(root, ["rev-parse", "--show-object-format"])).trim();
  if (format !== "sha1" && format !== "sha256") {
    throw new Error(`squeal: unsupported git object format "${format}" in ${root}`);
  }
  return format;
}
async function readCleanIndexHashes(root) {
  const [autocrlf, entries, status2] = await Promise.all([
    // `git config --get` exits 1 when the key is unset.
    runGit(root, ["config", "--get", "core.autocrlf"], { okCodes: [0, 1] }),
    runGit(root, ["ls-files", "--stage", "-v", "-z"]),
    runGit(root, [
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=no",
      "--ignore-submodules=all",
      "--no-renames"
    ])
  ]);
  if (AUTOCRLF_ON.has(autocrlf.trim().toLowerCase())) return /* @__PURE__ */ new Map();
  const listed = new Set(splitNul(status2).map((line) => line.slice(3)));
  const candidates = /* @__PURE__ */ new Map();
  for (const line of splitNul(entries)) {
    const tab = line.indexOf("	");
    const [tag, mode, oid, stage] = line.slice(0, tab).split(" ");
    const path = line.slice(tab + 1);
    if (tag !== "H" || stage !== "0" || !FILE_MODES.has(mode ?? "") || oid === void 0) continue;
    if (listed.has(path)) continue;
    candidates.set(path, oid);
  }
  if (candidates.size === 0) return candidates;
  const attributes = await runGit(root, ["check-attr", "-z", "--stdin", ...CONVERTING_ATTRIBUTES], {
    input: `${[...candidates.keys()].join("\0")}\0`
  });
  const fields = splitNul(attributes);
  for (let i = 0; i + 2 < fields.length; i += 3) {
    if (fields[i + 2] !== "unspecified") candidates.delete(fields[i]);
  }
  return candidates;
}
var CONVERTING_ATTRIBUTES, FILE_MODES, AUTOCRLF_ON;
var init_git_index = __esm({
  "src/core/hash/git-index.ts"() {
    "use strict";
    init_fs();
    CONVERTING_ATTRIBUTES = ["eol", "text", "crlf", "filter", "ident", "working-tree-encoding"];
    FILE_MODES = /* @__PURE__ */ new Set(["100644", "100755", "120000"]);
    AUTOCRLF_ON = /* @__PURE__ */ new Set(["true", "input", "yes", "on", "1"]);
  }
});

// src/core/hash/stat-cache.ts
function sameStat(a, b) {
  return a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.size === b.size && a.inode === b.inode;
}
function isRacy(stat5, hashedAt) {
  return hashedAt - stat5.mtimeMs < RACY_WINDOW_MS;
}
var RACY_WINDOW_MS, StatCache;
var init_stat_cache = __esm({
  "src/core/hash/stat-cache.ts"() {
    "use strict";
    RACY_WINDOW_MS = 2e3;
    StatCache = class _StatCache {
      entries = /* @__PURE__ */ new Map();
      absent = /* @__PURE__ */ new Set();
      racy = /* @__PURE__ */ new Set();
      upserted = /* @__PURE__ */ new Set();
      removed = /* @__PURE__ */ new Set();
      constructor(records = []) {
        for (const record of records) this.entries.set(record.path, record);
      }
      static load(repo, worktreeId) {
        return new _StatCache(repo.list(worktreeId));
      }
      get size() {
        return this.entries.size;
      }
      get(path) {
        return this.entries.get(path);
      }
      /** The file's hash, `null` when it is known to be absent, `undefined` when untracked. */
      hashOf(path) {
        const entry2 = this.entries.get(path);
        if (entry2) return entry2.hash;
        return this.absent.has(path) ? null : void 0;
      }
      isRacy(path) {
        return this.racy.has(path);
      }
      /** Paths with a file. Known-absent paths are not listed. */
      paths() {
        return this.entries.keys();
      }
      set(record, options = {}) {
        this.entries.set(record.path, record);
        this.absent.delete(record.path);
        if (options.racy) this.racy.add(record.path);
        else this.racy.delete(record.path);
        this.upserted.add(record.path);
        this.removed.delete(record.path);
      }
      /** Records that `path` has no file: drops its entry and marks it known absent. */
      delete(path) {
        this.absent.add(path);
        if (!this.entries.delete(path)) return;
        this.racy.delete(path);
        this.upserted.delete(path);
        this.removed.add(path);
      }
      /**
       * Writes the entries changed since the last flush or load, plus `updates`,
       * then applies `updates` in memory. If a write throws, memory and the
       * pending changes are as before, so a rolled-back transaction leaves the
       * cache matching the store and the next reconciliation sees the same
       * changes again.
       */
      flush(repo, worktreeId, updates = []) {
        const upserts = /* @__PURE__ */ new Map();
        const removals = new Set(this.removed);
        for (const path of this.upserted) upserts.set(path, this.entries.get(path));
        for (const update of updates) {
          if (update.kind === "set") {
            upserts.set(update.record.path, update.record);
            removals.delete(update.record.path);
          } else {
            upserts.delete(update.path);
            if (this.entries.has(update.path)) removals.add(update.path);
          }
        }
        if (upserts.size > 0) repo.upsertMany(worktreeId, [...upserts.values()]);
        if (removals.size > 0) repo.removeMany(worktreeId, [...removals]);
        for (const update of updates) {
          if (update.kind === "set") this.set(update.record, { racy: update.racy });
          else this.delete(update.path);
        }
        this.upserted.clear();
        this.removed.clear();
      }
    };
  }
});

// src/core/hash/hasher.ts
import { lstat as lstat2 } from "node:fs/promises";
import { join as join14 } from "node:path";
function createFsHasher(root, format) {
  return {
    async stat(path) {
      try {
        const stats = await lstat2(join14(root, path));
        if (!stats.isFile() && !stats.isSymbolicLink()) return null;
        return {
          mtimeMs: stats.mtimeMs,
          ctimeMs: stats.ctimeMs,
          size: stats.size,
          inode: stats.ino
        };
      } catch (error) {
        if (isMissing(error)) return null;
        throw new Error(`squeal: cannot stat ${path} in ${root}: ${error.message}`);
      }
    },
    hash: (path) => hashFile(join14(root, path), format),
    now: () => Date.now()
  };
}
async function seedStatCache(cache, root, paths, options) {
  const hasher = options.hasher ?? createFsHasher(root, options.objectFormat);
  const before = await mapConcurrent(paths, (path) => hasher.stat(path));
  const index = await readCleanIndexHashes(root);
  let fromIndex = 0;
  let fromBytes = 0;
  let missing = 0;
  await mapConcurrent(paths, async (path, i) => {
    const stat5 = await hasher.stat(path);
    const earlier = before[i];
    const indexHash = index.get(path);
    if (stat5 && earlier && indexHash !== void 0 && sameStat(stat5, earlier)) {
      cache.set({ path, ...stat5, hash: indexHash }, { racy: isRacy(stat5, hasher.now()) });
      fromIndex++;
      return;
    }
    const hashedAt = hasher.now();
    const hash = stat5 ? await hasher.hash(path) : null;
    if (!stat5 || hash === null) {
      cache.delete(path);
      missing++;
      return;
    }
    cache.set({ path, ...stat5, hash }, { racy: isRacy(stat5, hashedAt) });
    fromBytes++;
  });
  return { fromIndex, fromBytes, missing };
}
var init_hasher = __esm({
  "src/core/hash/hasher.ts"() {
    "use strict";
    init_fs();
    init_blob();
    init_concurrency();
    init_git_index();
    init_stat_cache();
  }
});

// src/core/hash/index.ts
var init_hash = __esm({
  "src/core/hash/index.ts"() {
    "use strict";
    init_blob();
    init_concurrency();
    init_git_index();
    init_hasher();
    init_stat_cache();
  }
});

// src/core/revision/reconcile.ts
async function statCandidates(paths, hasher) {
  const sorted = [...new Set(paths)].sort(compare);
  const stats = await mapConcurrent(sorted, (path) => hasher.stat(path));
  return sorted.map((path, i) => ({ path, stat: stats[i] ?? null }));
}
async function diffCandidates(candidates, cache, hasher) {
  const statOf = /* @__PURE__ */ new Map();
  for (const candidate of candidates) statOf.set(candidate.path, candidate.stat);
  const paths = [...statOf.keys()].sort(compare);
  const observed = await mapConcurrent(paths, async (path) => {
    const stat5 = statOf.get(path) ?? null;
    const cached = cache.get(path);
    if (stat5 && cached && sameStat(cached, stat5) && !cache.isRacy(path)) return null;
    const hashedAt = hasher.now();
    const hash = stat5 ? await hasher.hash(path) : null;
    return { path, cached, stat: stat5, hash, hashedAt };
  });
  const changes = [];
  const updates = [];
  for (const entry2 of observed) {
    if (!entry2) continue;
    const { path, cached, stat: stat5, hash, hashedAt } = entry2;
    if (!stat5 || hash === null) {
      if (cached) changes.push({ path, oldHash: cached.hash, newHash: null });
      if (cache.hashOf(path) !== null) updates.push({ kind: "delete", path });
      continue;
    }
    const record = {
      path,
      mtimeMs: stat5.mtimeMs,
      ctimeMs: stat5.ctimeMs,
      size: stat5.size,
      inode: stat5.inode,
      hash
    };
    updates.push({ kind: "set", record, racy: isRacy(stat5, hashedAt) });
    if (cached?.hash !== hash) changes.push({ path, oldHash: cached?.hash ?? null, newHash: hash });
  }
  return { changes, updates };
}
async function diffBatch(batch, cache, hasher) {
  return { trigger: batch.trigger, ...await diffCandidates(batch.paths, cache, hasher) };
}
function commitBatch(diff, cache, context) {
  let revision = null;
  if (diff.changes.length > 0) {
    if (!context.head) {
      throw new Error(
        `squeal: ${diff.changes.length} changes in worktree ${context.worktreeId} need HEAD to create a revision`
      );
    }
    revision = context.revisions.append({
      worktreeId: context.worktreeId,
      createdAt: context.now?.() ?? Date.now(),
      head: context.head.head,
      dirty: context.head.dirty,
      trigger: diff.trigger,
      changes: diff.changes
    });
  }
  cache.flush(context.fileHashes, context.worktreeId, diff.updates);
  return revision;
}
async function reconcile(batch, cache, hasher, context) {
  const diff = await diffBatch(batch, cache, hasher);
  const head = diff.changes.length > 0 ? await context.head() : null;
  const { store } = context;
  return store.transaction(
    () => commitBatch(diff, cache, {
      worktreeId: context.worktreeId,
      head,
      revisions: store.revisions,
      fileHashes: store.fileHashes,
      now: () => context.now?.() ?? Date.now()
    })
  );
}
var init_reconcile = __esm({
  "src/core/revision/reconcile.ts"() {
    "use strict";
    init_fs();
    init_hash();
  }
});

// src/core/revision/index.ts
var init_revision2 = __esm({
  "src/core/revision/index.ts"() {
    "use strict";
    init_reconcile();
  }
});

// src/core/scheduler/batch.ts
async function reconcileBatch(context, ledger, batch) {
  const { keys, hasher, store, worktreeId } = context;
  let diff = await diffBatch(batch, keys.cache, hasher);
  if (diff.changes.length === 0 && batch.trigger !== "watch") {
    const moved = await keys.lockfileCandidates();
    if (moved.length > 0) {
      const paths = await statCandidates(moved, hasher);
      const lockfiles = await diffBatch({ trigger: batch.trigger, paths }, keys.cache, hasher);
      diff = { ...lockfiles, updates: [...diff.updates, ...lockfiles.updates] };
    }
  }
  const head = diff.changes.length > 0 ? await context.head() : null;
  return store.transaction(() => {
    const revision = commitBatch(diff, keys.cache, {
      worktreeId,
      head,
      revisions: store.revisions,
      fileHashes: store.fileHashes,
      now: context.now
    });
    if (revision === null) return null;
    ledger.revision = { number: revision.number, head: revision.head, dirty: revision.dirty };
    for (const change of revision.changes) {
      ledger.tierChanges?.add(change.path);
      ledger.refineChanges?.add(change.path);
    }
    const content = rekeyContent(context, ledger, revision);
    ledger.commit();
    return { revision, content };
  });
}
var init_batch = __esm({
  "src/core/scheduler/batch.ts"() {
    "use strict";
    init_revision2();
    init_revision();
  }
});

// src/core/scheduler/queue.ts
function priorityOf(file, changed, direct = NO_DIRECT_IMPORTERS) {
  if (file.failing) return Priority.failing;
  if (changed.has(file.ref.path) || direct.has(file.id)) return Priority.direct;
  return file.resultKey === null ? Priority.neverRun : Priority.transitive;
}
function byDuration(a, b) {
  return a === b ? 0 : a < b ? -1 : 1;
}
var Priority, NO_DIRECT_IMPORTERS, RunQueue;
var init_queue = __esm({
  "src/core/scheduler/queue.ts"() {
    "use strict";
    init_fs();
    init_keys();
    Priority = { failing: 0, direct: 1, transitive: 2, neverRun: 3 };
    NO_DIRECT_IMPORTERS = /* @__PURE__ */ new Set();
    RunQueue = class {
      #entries = /* @__PURE__ */ new Map();
      #seq = 0;
      get size() {
        return this.#entries.size;
      }
      has(ref) {
        return this.#entries.has(testFileId(ref));
      }
      /**
       * Queues a test file, or raises the priority of its entry. A `forced` entry
       * (`run --all --force`) runs even when its key has a result.
       */
      add(ref, priority, forced = false) {
        const id = testFileId(ref);
        const entry2 = this.#entries.get(id);
        if (entry2) {
          entry2.priority = Math.min(entry2.priority, priority);
          entry2.forced ||= forced;
          return;
        }
        this.#entries.set(id, { ref, priority, seq: this.#seq++, forced });
      }
      remove(ref) {
        return this.#entries.delete(testFileId(ref));
      }
      isForced(ref) {
        return this.#entries.get(testFileId(ref))?.forced ?? false;
      }
      /**
       * Priority, then shortest last known duration with unknown ones last, then
       * first queued, then project and path. Spec 001 D5 step 4: "within a class,
       * shortest last known duration first, so a slow integration file never
       * delays the edited module's own unit test."
       */
      ordered(durationOf2 = () => null) {
        const durations = /* @__PURE__ */ new Map();
        for (const entry2 of this.#entries.values()) {
          durations.set(entry2, durationOf2(entry2.ref) ?? Number.POSITIVE_INFINITY);
        }
        const duration2 = (entry2) => durations.get(entry2) ?? Number.POSITIVE_INFINITY;
        return [...this.#entries.values()].sort(
          (a, b) => a.priority - b.priority || byDuration(duration2(a), duration2(b)) || a.seq - b.seq || compare(a.ref.project, b.ref.project) || compare(a.ref.path, b.ref.path)
        ).map((entry2) => entry2.ref);
      }
    };
  }
});

// src/core/scheduler/bootstrap.ts
import { randomUUID as randomUUID2 } from "node:crypto";
async function bootstrap(context, ledger) {
  const { store, keys, runner, worktreeId, policy } = context;
  const latest = store.revisions.latest(worktreeId);
  const revision = await keys.bootstrap(context.head) ?? latest;
  ledger.revision = revision === null ? { number: 0, ...await context.head() } : { number: revision.number, head: revision.head, dirty: revision.dirty };
  const failures = /* @__PURE__ */ new Map();
  await readEnvironments(context, failures);
  const listed = await tryRunner(context, "testFiles", () => runner.testFiles());
  ledger.listingFailed = listed === null;
  const previousKeys = new Map(
    store.testFileKeys.list(worktreeId).map((row) => [testFileId(row.testFile), row])
  );
  const refs = listed ?? [...previousKeys.values()].map((row) => row.testFile);
  const known2 = knownChecks(context);
  const fromStore = /* @__PURE__ */ new Set();
  const unresolved = [];
  for (const ref of refs) {
    const file = ledger.addFile(ref);
    restore(file, known2.get(file.id));
    const record = store.testFiles.get(ref);
    if (record !== null) {
      keys.setClosure({ testFile: ref, paths: record.closure.paths });
      fromStore.add(file.id);
    } else {
      unresolved.push(ref);
    }
  }
  await resolveClosures(context, unresolved, failures);
  if (listed !== null) {
    for (const row of previousKeys.values()) {
      if (ledger.file(row.testFile)) continue;
      const gone = ledger.addFile(row.testFile);
      restore(gone, known2.get(gone.id));
      ledger.removeFile(gone);
    }
  }
  const checkpointId = randomUUID2();
  const lookup = (files) => ledger.settle(files, NOTHING_CHANGED, { checkpointId, queueMisses: false });
  const first = lookup(refs);
  const recheck = first.filter((file) => fromStore.has(file.id));
  await resolveClosures(
    context,
    recheck.map((file) => file.ref),
    failures
  );
  ledger.counters.misses -= recheck.length;
  const misses = [
    ...first.filter((file) => !fromStore.has(file.id)),
    ...lookup(recheck.map((file) => file.ref))
  ];
  for (const file of misses) {
    const previous = previousKeys.get(file.id)?.key ?? null;
    if (previous === null) continue;
    const results2 = store.results.byKey(previous, 0);
    if (results2.length === 0) continue;
    file.resultKey = previous;
    file.durationMs = durationOf(results2);
  }
  const unkeyed = [...ledger.files.values()].filter((file) => file.key === null);
  ledger.checkpoints.start(
    checkpointId,
    "baseline",
    ledger.revision.number,
    [...misses, ...unkeyed].map((file) => file.ref)
  );
  if (policy.baseline.onStart === "lookup-only") {
    ledger.checkpoints.finish("abandoned");
  } else {
    for (const file of misses) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
  }
  for (const file of unkeyed) ledger.checkpoints.failed(file.ref);
  if (failures.size > 0) block(ledger, failures);
  ledger.commit({ refined: ledger.revision.number });
  const persisted = persistedNoteTexts(store, worktreeId);
  for (const text of unmatchedInputNotes(keys.unmatchedInputs(testFilePaths(ledger)))) {
    if (!persisted.has(text)) context.note(text);
  }
}
function testFilePaths(ledger) {
  return [...ledger.files.values()].map((file) => file.ref.path);
}
function knownChecks(context) {
  const byFile = /* @__PURE__ */ new Map();
  for (const state of context.store.knownStates.list(context.worktreeId)) {
    const id = testFileId({ project: state.check.project, path: state.check.testPath });
    let known2 = byFile.get(id);
    if (!known2) {
      known2 = { checks: [], failing: false };
      byFile.set(id, known2);
    }
    known2.checks.push(state.check);
    known2.failing ||= state.outcome === "fail";
  }
  return byFile;
}
function restore(file, known2) {
  if (!known2) return;
  file.checks = [...known2.checks];
  file.failing = known2.failing;
}
var init_bootstrap = __esm({
  "src/core/scheduler/bootstrap.ts"() {
    "use strict";
    init_keys();
    init_context();
    init_failures();
    init_files();
    init_notes2();
    init_queue();
    init_revision();
  }
});

// src/core/watcher/git.ts
async function checkIgnored(root, paths) {
  if (paths.length === 0) return /* @__PURE__ */ new Set();
  const input = `${paths.join("\0")}\0`;
  const out = await runGit(root, ["check-ignore", "-z", "--stdin"], { input, okCodes: [0, 1] });
  return new Set(splitNul(out));
}
async function listIgnored(root) {
  const out = await runGit(root, [
    "ls-files",
    "-z",
    "--others",
    "--ignored",
    "--exclude-standard",
    "--directory",
    "--no-empty-directory"
  ]);
  return splitNul(out);
}
async function gitStatus(root) {
  const out = await runGit(root, [
    "--no-optional-locks",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--no-renames",
    "--ignore-submodules=all"
  ]);
  const paths = /* @__PURE__ */ new Set();
  const nestedRepos = /* @__PURE__ */ new Set();
  for (const entry2 of splitNul(out)) {
    const path = entry2.slice(3);
    if (path.endsWith("/")) nestedRepos.add(path.slice(0, -1));
    else paths.add(path);
  }
  return { paths: [...paths].sort(), nestedRepos: [...nestedRepos].sort() };
}
async function listSubmodules(root) {
  const out = await runGit(
    root,
    ["config", "-z", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
    // 1: no match or no such file.
    { okCodes: [0, 1] }
  );
  return splitNul(out).flatMap((entry2) => {
    const value = entry2.slice(entry2.indexOf("\n") + 1);
    return value === "" ? [] : [value];
  });
}
var init_git2 = __esm({
  "src/core/watcher/git.ts"() {
    "use strict";
    init_fs();
  }
});

// src/core/scheduler/lockfiles.ts
import { join as join15 } from "node:path";
var Lockfiles;
var init_lockfiles = __esm({
  "src/core/scheduler/lockfiles.ts"() {
    "use strict";
    init_fs();
    init_keys();
    Lockfiles = class {
      constructor(root) {
        this.root = root;
      }
      root;
      #projects = /* @__PURE__ */ new Map();
      /** Lockfile paths `moved` found, and the projects that read them. */
      #moved = /* @__PURE__ */ new Map();
      /** Finds each project's lockfile. Returns each project's installed-dependency fingerprint. */
      async set(environments) {
        this.#projects.clear();
        this.#moved.clear();
        const fingerprints = /* @__PURE__ */ new Map();
        for (const environment of environments) {
          const root = environment.root === void 0 || environment.root === "" ? this.root : join15(this.root, environment.root);
          this.#projects.set(environment.project, { root, lockfile: await this.#find(root) });
          fingerprints.set(
            environment.project,
            await installedDependenciesFingerprint(root, this.root)
          );
        }
        return fingerprints;
      }
      /** Every project's lockfile path, once each. */
      paths() {
        const paths = /* @__PURE__ */ new Set();
        for (const { lockfile } of this.#projects.values()) if (lockfile) paths.add(lockfile.path);
        return [...paths];
      }
      /** The lockfile path of one project, or `null`. */
      of(project) {
        return this.#projects.get(project)?.lockfile?.path ?? null;
      }
      /** Projects whose fingerprint reads `path`: their lockfile, a file under its patches, or a moved lockfile. */
      projectsReading(path) {
        const projects = new Set(this.#moved.get(path));
        for (const [project, { lockfile }] of this.#projects) {
          if (!lockfile) continue;
          if (path === lockfile.path) projects.add(project);
          if (lockfile.patches !== null && path.startsWith(`${lockfile.patches}/`))
            projects.add(project);
        }
        return [...projects];
      }
      /**
       * Lockfiles that are not the ones the fingerprints were taken from: a first
       * install created one, or another package manager's replaced it. Returns
       * the old and new paths, sorted.
       */
      async moved() {
        this.#moved.clear();
        for (const [project, { root, lockfile }] of this.#projects) {
          const found = await this.#find(root);
          if (found?.path === lockfile?.path) continue;
          for (const path of [lockfile?.path, found?.path]) {
            if (path === void 0) continue;
            this.#moved.set(path, [...this.#moved.get(path) ?? [], project]);
          }
        }
        return [...this.#moved.keys()].sort();
      }
      async #find(projectRoot) {
        const found = await findInstalledLockfile(projectRoot, this.root);
        if (found === null) return null;
        const path = toRelative(this.root, found.path);
        if (path === null) return null;
        return { path, patches: found.patches === null ? null : toRelative(this.root, found.patches) };
      }
    };
  }
});

// src/core/scheduler/keying.ts
import { createHash as createHash8 } from "node:crypto";
function sameList2(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
var PROVISIONAL_ENVIRONMENT, WorktreeKeys;
var init_keying = __esm({
  "src/core/scheduler/keying.ts"() {
    "use strict";
    init_fs();
    init_hash();
    init_keys();
    init_revision2();
    init_git2();
    init_lockfiles();
    PROVISIONAL_ENVIRONMENT = "squeal-provisional-environment/1";
    WorktreeKeys = class {
      constructor(options) {
        this.options = options;
        this.#policy = options.policy;
        this.#isDeclared = createInputMatcher(inputGlobs(options.policy.inputs));
        this.cache = StatCache.load(options.store.fileHashes, options.worktreeId);
        this.#lockfiles = new Lockfiles(options.root);
        this.index = new KeyIndex((path) => this.cache.hashOf(path));
      }
      options;
      cache;
      index;
      isDeclaredInput = (path) => this.#isDeclared(path);
      #runnerClosures = /* @__PURE__ */ new Map();
      #environments = /* @__PURE__ */ new Map();
      #environmentFiles = /* @__PURE__ */ new Set();
      #extra = /* @__PURE__ */ new Set();
      #untracked = /* @__PURE__ */ new Set();
      #lockfiles;
      /** Lockfile paths already checked against `.gitignore`. */
      #ignoreChecked = /* @__PURE__ */ new Set();
      #declared = createDeclaredInputs([], []);
      #policy;
      #isDeclared;
      /**
       * Brings the stat cache up to date at daemon start. Cached paths are
       * reconciled, so what changed while no daemon ran becomes a revision.
       * Tracked and untracked files git knows and the cache does not are hashed
       * without a revision: there is nothing earlier to compare them with.
       * Cached paths git ignores entered the cache because a closure or an
       * environment named them, so they are watched again as extra files.
       */
      async bootstrap(head) {
        let revision = null;
        if (this.cache.size > 0) {
          const paths = await statCandidates(this.cache.paths(), this.options.hasher);
          revision = await this.reconcile({ trigger: "start", paths }, head);
        }
        const listed = splitNul(
          await runGit(this.options.root, [
            "ls-files",
            "-z",
            "--cached",
            "--others",
            "--exclude-standard"
          ])
        );
        const known2 = new Set(listed);
        const unlisted = [...this.cache.paths()].filter((path) => !known2.has(path));
        for (const path of await checkIgnored(this.options.root, unlisted)) this.#extra.add(path);
        await this.#seed(listed.filter((path) => this.cache.hashOf(path) === void 0));
        this.#declared = createDeclaredInputs(this.#policy.inputs, this.#knownFiles());
        return revision;
      }
      /** `reconcile` on this worktree's cache. Calls must not overlap (the scheduler's lock). */
      async reconcile(batch, head) {
        const { worktreeId, store, hasher } = this.options;
        return reconcile(batch, this.cache, hasher, { worktreeId, store, head });
      }
      /**
       * Sets the environment hash of every project from runner output (D3). The
       * runner files and each project's installed lockfile are hashed first; the
       * lockfile is looked up from the project's root (review N8).
       */
      async setEnvironments(environments) {
        const { squealVersion: squealVersion2, env } = this.options;
        const policy = this.#policy;
        this.#environments.clear();
        this.#environmentFiles.clear();
        for (const environment of environments) {
          this.#environments.set(environment.project, environment);
          for (const path of environment.files) this.#environmentFiles.add(path);
        }
        const fingerprints = await this.#lockfiles.set(environments);
        const lockPaths = this.#lockfiles.paths();
        await this.track([...this.#environmentFiles, ...lockPaths]);
        await this.#watchIgnored(lockPaths);
        const hashOf = (path) => this.cache.hashOf(path);
        return environments.flatMap((environment) => {
          const core = coreEnvironmentInputs({
            squealVersion: squealVersion2,
            installedDependencies: fingerprints.get(environment.project) ?? "none",
            allowlist: policy.env.allowlist,
            ...env === void 0 ? {} : { env }
          });
          return this.index.setEnvironment(
            environment.project,
            environmentHash(core, environment, hashOf)
          );
        });
      }
      /**
       * Moves the environment hash of every project whose environment inputs are
       * among `changes`, without the runner, so their keys move in the same
       * transaction as the revision (review B2). The provisional hash never
       * equals a real one, so its keys find no stored result; `setEnvironments`
       * replaces it once the runner answers.
       */
      provisionalEnvironments(changes) {
        const inputs2 = /* @__PURE__ */ new Map();
        for (const change of changes) {
          for (const project of this.#projectsReading(change.path)) {
            inputs2.set(project, [...inputs2.get(project) ?? [], [change.path, change.newHash]]);
          }
        }
        return [...inputs2].flatMap(([project, changed]) => this.#provisional(project, changed));
      }
      /** A provisional environment hash for `project` from its current one and what changed. */
      #provisional(project, changed) {
        const previous = this.index.environment(project);
        if (previous === void 0) return [];
        const encoded = JSON.stringify([PROVISIONAL_ENVIRONMENT, previous, changed]);
        return this.index.setEnvironment(project, createHash8("sha256").update(encoded).digest("hex"));
      }
      /**
       * Applies a reloaded policy (spec 001 D11, review S3). New `inputs`:
       * declared inputs are selected again and every closure re-assembled with
       * them. A new `env.allowlist`: every environment hash moves to a
       * provisional one in this call, so no key keeps a result of the old
       * environment; `environment: true` asks the caller to read the
       * environments again, which sets the real hash with the new allowlist.
       */
      setPolicy(policy) {
        const previous = this.#policy;
        this.#policy = policy;
        const changes = [];
        if (!sameInputs(previous.inputs, policy.inputs)) {
          this.#isDeclared = createInputMatcher(inputGlobs(policy.inputs));
          this.#declared = createDeclaredInputs(policy.inputs, this.#knownFiles());
          changes.push(
            ...[...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner))
          );
        }
        const environment = !sameList2(previous.env.allowlist, policy.env.allowlist);
        if (environment) {
          for (const project of this.#environments.keys()) {
            changes.push(...this.#provisional(project, [["env.allowlist", policy.env.allowlist]]));
          }
        }
        return { changes, environment };
      }
      /**
       * True when a change to `path` can change an environment hash: a runner
       * file (config, setup files and their closures), an installed lockfile, or
       * a file under its patches directory.
       */
      isEnvironmentInput(path) {
        return this.#projectsReading(path).length > 0;
      }
      /**
       * Installed lockfiles that are not the ones the environment was last hashed
       * with: a first install created one, or another package manager's replaced
       * it. Returns the old and new paths, so a reconciliation of them records
       * the move as a revision (review N3). Their old paths are watched; a new
       * one is in an ignored directory no watch batch reports, so reconciliation
       * passes ask here.
       */
      lockfileCandidates() {
        return this.#lockfiles.moved();
      }
      /** Sets a test file's closure: the runner's paths plus this worktree's declared inputs (D3). */
      setClosure(runner) {
        this.#runnerClosures.set(testFileId(runner.testFile), runner);
        const update = this.index.setClosure(
          assembleClosure(runner, this.#declared.for(runner.testFile.path))
        );
        for (const path of update.untracked) this.#untracked.add(path);
        return update.changes;
      }
      /** Entries of policy `inputs` that select no test file among `testFiles` or no known file (review wave 4.5, S5). */
      unmatchedInputs(testFiles) {
        return unmatchedInputs(this.#policy.inputs, testFiles, this.#knownFiles());
      }
      removeTestFile(ref) {
        this.#runnerClosures.delete(testFileId(ref));
        this.index.removeTestFile(ref);
      }
      /**
       * Re-selects declared inputs when one was added or deleted, and re-assembles
       * every closure with them. Returns the key changes, or `null` when no
       * declared input was added or deleted.
       */
      updateDeclaredInputs(changes) {
        const structural = changes.some(
          (c) => (c.oldHash === null || c.newHash === null) && this.isDeclaredInput(c.path)
        );
        if (!structural) return null;
        this.#declared = createDeclaredInputs(this.#policy.inputs, this.#knownFiles());
        return [...this.#runnerClosures.values()].flatMap((runner) => this.setClosure(runner));
      }
      /** Hashes the closure paths the stat cache did not track, then re-keys with them. */
      async trackUntracked() {
        const paths = [...this.#untracked];
        this.#untracked.clear();
        if (paths.length === 0) return [];
        await this.track(paths);
        return this.index.rekey(paths);
      }
      /** Hashes the untracked ones among `paths`; the gitignored ones become extra files. */
      async track(paths) {
        const untracked = [...new Set(paths)].filter((path) => this.cache.hashOf(path) === void 0);
        if (untracked.length === 0) return;
        await this.#seed(untracked);
        const ignored = await checkIgnored(this.options.root, untracked);
        const before = this.#extra.size;
        for (const path of ignored) this.#extra.add(path);
        if (this.#extra.size > before) this.options.onExtraFiles(this.extraFiles());
      }
      /** Gitignored paths watched anyway (D2), sorted. */
      extraFiles() {
        return [...this.#extra].sort();
      }
      /** What the stability check compares for a test file: its closure, its project's environment files, its lockfile. */
      stabilityPaths(ref) {
        const paths = new Set(this.index.closure(ref)?.paths ?? []);
        for (const path of this.#environments.get(ref.project)?.files ?? []) paths.add(path);
        const lockfile = this.#lockfiles.of(ref.project);
        if (lockfile !== null) paths.add(lockfile);
        return [...paths];
      }
      /** Projects whose environment hash reads `path`. */
      #projectsReading(path) {
        const projects = new Set(this.#lockfiles.projectsReading(path));
        for (const [project, environment] of this.#environments) {
          if (environment.files.includes(path)) projects.add(project);
        }
        return [...projects];
      }
      /** Lockfiles tracked by a reconciliation, not by `track`, are watched too when gitignored (D2). */
      async #watchIgnored(paths) {
        const unchecked = paths.filter(
          (path) => !this.#extra.has(path) && !this.#ignoreChecked.has(path)
        );
        if (unchecked.length === 0) return;
        for (const path of unchecked) this.#ignoreChecked.add(path);
        const ignored = await checkIgnored(this.options.root, unchecked);
        const before = this.#extra.size;
        for (const path of ignored) this.#extra.add(path);
        if (this.#extra.size > before) this.options.onExtraFiles(this.extraFiles());
      }
      async #seed(paths) {
        if (paths.length === 0) return;
        const { root, objectFormat, hasher, store, worktreeId } = this.options;
        await seedStatCache(this.cache, root, paths, { objectFormat, hasher });
        store.transaction(() => this.cache.flush(store.fileHashes, worktreeId));
      }
      #knownFiles() {
        return [...this.cache.paths(), ...this.#extra];
      }
    };
  }
});

// src/core/scheduler/checkpoints.ts
var Checkpoints;
var init_checkpoints = __esm({
  "src/core/scheduler/checkpoints.ts"() {
    "use strict";
    init_keys();
    Checkpoints = class {
      constructor(store, worktreeId, now) {
        this.store = store;
        this.worktreeId = worktreeId;
        this.now = now;
      }
      store;
      worktreeId;
      now;
      #active = null;
      get active() {
        const active = this.#active;
        return active === null ? null : { record: active.record, remaining: active.remaining.size };
      }
      /** Id of the open checkpoint when it requested `ref`, else `null`. */
      idFor(ref) {
        const active = this.#active;
        return active?.remaining.has(testFileId(ref)) ? active.record.id : null;
      }
      /** Records a new checkpoint, abandoning the open one. With no files it completes at once. */
      start(id, kind, revision, testFiles, strict = false) {
        this.finish("abandoned");
        const record = this.store.checkpoints.start({
          id,
          worktreeId: this.worktreeId,
          revision,
          kind,
          testFiles,
          startedAt: this.now()
        });
        this.#active = { record, remaining: new Set(testFiles.map(testFileId)), strict, failed: false };
        this.#settle();
        return record;
      }
      /** `ref` got a result, attributed to checkpoint `by` (`StateProvenance.checkpointId`). */
      done(ref, by) {
        const active = this.#active;
        if (active === null || active.strict && by !== active.record.id) return;
        active.remaining.delete(testFileId(ref));
        this.#settle();
      }
      /** `ref` crashed or timed out: the checkpoint cannot complete. */
      failed(ref) {
        const active = this.#active;
        if (!active?.remaining.delete(testFileId(ref))) return;
        active.failed = true;
        this.#settle();
      }
      /** Ends the open checkpoint, if any. */
      finish(end) {
        const active = this.#active;
        if (active === null) return;
        this.#active = null;
        this.store.checkpoints.finish(active.record.id, end, this.now());
      }
      #settle() {
        const active = this.#active;
        if (active !== null && active.remaining.size === 0) {
          this.finish(active.failed ? "abandoned" : "completed");
        }
      }
    };
  }
});

// src/core/scheduler/ledger.ts
var MAX_DISCARDS, Ledger;
var init_ledger = __esm({
  "src/core/scheduler/ledger.ts"() {
    "use strict";
    init_keys();
    init_types();
    init_checkpoints();
    init_context();
    init_files();
    init_queue();
    MAX_DISCARDS = 3;
    Ledger = class {
      constructor(context) {
        this.context = context;
        this.checkpoints = new Checkpoints(context.store, context.worktreeId, context.now);
      }
      context;
      files = /* @__PURE__ */ new Map();
      queue = new RunQueue();
      checkpoints;
      revision = { number: 0, head: null, dirty: false };
      /** Paths changed by revisions since the tier in flight was selected; `null` with no tier in flight. */
      tierChanges = null;
      /**
       * Paths changed by revisions since the runner phase of the refinement in
       * flight started; `null` with none in flight (`applyRunnerPart`).
       */
      refineChanges = null;
      /** Some files are blocked by a runner failure; the next revision or `run --all` retries the runner. */
      broken = false;
      /** The last test file listing failed; the next revision lists again. */
      listingFailed = false;
      counters = {
        hits: 0,
        misses: 0,
        discarded: 0,
        started: 0,
        completed: 0,
        crashed: 0,
        timedOut: 0
      };
      #dirty = /* @__PURE__ */ new Set();
      #removed = [];
      #applied = [];
      #unknown = [];
      #retired = [];
      file(ref) {
        return this.files.get(testFileId(ref));
      }
      /** The queue in run order: D5 step 4 classes, shortest last known duration first within one. */
      ordered() {
        return this.queue.ordered((ref) => this.file(ref)?.durationMs ?? null);
      }
      addFile(ref) {
        const file = newFileState(ref);
        this.files.set(file.id, file);
        this.#dirty.add(file.id);
        return file;
      }
      /** Forgets a test file that no longer exists and retires its checks. */
      removeFile(file) {
        this.context.keys.removeTestFile(file.ref);
        this.queue.remove(file.ref);
        this.files.delete(file.id);
        this.#retired.push(...file.checks);
        this.#removed.push(file.ref);
        this.checkpoints.done(file.ref, this.checkpoints.idFor(file.ref));
      }
      /**
       * Takes each file's key from the key index and decides what it needs.
       *
       * Spec 001 D5 step 3: "looks each new key up in the store. A hit is promoted
       * to current for this worktree with its provenance intact. No run is
       * needed." A key that already has this worktree's results, that the tier in
       * flight runs, or that crashed (D12) needs nothing. Forced entries stay
       * queued. Returns the misses.
       */
      settle(refs, changed, options = {}) {
        const misses = [];
        const seen = /* @__PURE__ */ new Set();
        for (const ref of refs) {
          const file = this.file(ref);
          if (!file || seen.has(file.id)) continue;
          seen.add(file.id);
          const key = this.context.keys.index.key(ref);
          if (key !== file.key) {
            file.key = key;
            this.#dirty.add(file.id);
          }
          if (this.queue.isForced(ref)) continue;
          if (key === null || key === file.runningKey || key === file.unknownKey || key === file.resultKey) {
            this.queue.remove(ref);
            this.#syncPhase(file);
            continue;
          }
          const hits = this.context.store.results.byKey(key, this.context.now());
          if (hits.length > 0) {
            this.counters.hits++;
            const checkpointId = options.checkpointId ?? this.checkpoints.idFor(ref);
            this.applyResults(file, key, hits, checkpointId);
            continue;
          }
          this.counters.misses++;
          misses.push(file);
          if (file.blocked !== null) {
            this.queue.remove(ref);
            this.#syncPhase(file);
          } else if (options.queueMisses !== false) {
            this.enqueue(file, priorityOf(file, changed, options.direct));
          }
        }
        return misses;
      }
      /**
       * Makes `results` the current results of `file` under `key`: from a run of
       * this worktree or a lookup hit. Checks of the previous results that are
       * not among them are retired (D8).
       */
      applyResults(file, key, results2, checkpointId) {
        if (results2.length > 0) this.#applied.push({ results: results2, checkpointId });
        const next = results2.map((r) => r.check);
        const kept = new Set(next.map(checkId));
        this.#retired.push(...file.checks.filter((check) => !kept.has(checkId(check))));
        file.resultKey = key;
        file.checks = next;
        file.failing = results2.some((r) => r.outcome === "fail");
        file.durationMs = durationOf(results2) ?? file.durationMs;
        file.unknownKey = null;
        file.discards = 0;
        file.blocked = null;
        if (!this.queue.isForced(file.ref)) this.queue.remove(file.ref);
        this.#syncPhase(file);
        this.checkpoints.done(file.ref, checkpointId);
      }
      enqueue(file, priority, forced = false) {
        this.queue.add(file.ref, priority, forced);
        this.#syncPhase(file);
      }
      /** The tier holding these files starts or ends. */
      setRunning(file, key) {
        file.runningKey = key;
        this.#syncPhase(file);
      }
      /**
       * Spec 001 D12: a crash, a timeout, or inputs that never hold still. Nothing
       * is stored under a key; the files' checks become `unknown` at this revision.
       * Spec 001 D5: a checkpoint containing an `unknown` file ends `abandoned`.
       */
      markUnknown(entries, reason2) {
        if (entries.length === 0) return;
        for (const { file, key } of entries) {
          file.unknownKey = key;
          if (file.key === key && !this.queue.isForced(file.ref)) this.queue.remove(file.ref);
          this.#syncPhase(file);
          this.checkpoints.failed(file.ref);
        }
        this.#unknown.push({ testFiles: entries.map((e) => e.file.ref), reason: reason2 });
      }
      /**
       * Spec 001 D5: "that file's results are discarded as unreliable and the file
       * is re-queued". After `MAX_DISCARDS` in a row at a key that did not move the
       * file is `unknown` until its key changes: something rewrites its inputs
       * during every run. A discard whose key moved is an edit the agent made
       * while the file ran; it is not counted (review S5).
       */
      discard(file, key) {
        this.counters.discarded++;
        file.discards = file.key === key ? file.discards + 1 : 0;
        if (file.discards >= MAX_DISCARDS) {
          this.markUnknown([{ file, key }], `inputs changed during ${MAX_DISCARDS} runs in a row`);
        } else if (file.key !== null && file.blocked === null) {
          this.enqueue(file, priorityOf(file, NOTHING_CHANGED));
        }
      }
      /**
       * Writes what this round of work owes the store and the sink, in one
       * transaction. `refined` is the revision whose runner part this commit
       * applies; it becomes the worktree's refined revision (`refinedMetaKey`,
       * spec 001 D2 as amended), so headers stop counting that runner part as
       * pending in the same transaction that applies it.
       */
      commit(options = {}) {
        const { store, sink, worktreeId } = this.context;
        const revision = this.revision.number;
        const rows = [];
        const removed = this.#removed.splice(0);
        for (const id of this.#dirty) {
          const file = this.files.get(id);
          if (!file) continue;
          const pending = file.key === null ? null : file.phase;
          rows.push({ worktreeId, testFile: file.ref, key: file.key, revision, pending });
        }
        this.#dirty.clear();
        const applied = this.#applied;
        const unknown = this.#unknown;
        const retired = this.#retired;
        this.#applied = [];
        this.#unknown = [];
        this.#retired = [];
        store.transaction(() => {
          if (rows.length > 0) store.testFileKeys.upsertMany(rows);
          if (removed.length > 0) store.testFileKeys.remove(worktreeId, removed);
          for (const { results: results2, checkpointId } of applied) {
            sink.applyResults(worktreeId, revision, results2, { checkpointId });
          }
          for (const { testFiles, reason: reason2 } of unknown) {
            sink.markUnknown(worktreeId, revision, testFiles, reason2);
          }
          if (retired.length > 0) sink.retire(worktreeId, retired);
          for (const [checkpointId, testFiles] of this.#byCheckpoint(rows)) {
            sink.refresh(worktreeId, revision, { checkpointId }, testFiles);
          }
          if (options.refined !== void 0) {
            store.meta.set(refinedMetaKey(worktreeId), String(options.refined));
          }
        });
      }
      #byCheckpoint(rows) {
        const groups = /* @__PURE__ */ new Map();
        for (const { testFile } of rows) {
          const id = this.checkpoints.idFor(testFile);
          const group = groups.get(id);
          if (group) group.push(testFile);
          else groups.set(id, [testFile]);
        }
        return groups;
      }
      /** Phase follows the queue and the tier in flight; a change is owed to `test_file_keys`. */
      #syncPhase(file) {
        const phase = file.runningKey !== null ? "running" : this.queue.has(file.ref) ? "queued" : null;
        if (phase === file.phase) return;
        file.phase = phase;
        this.#dirty.add(file.id);
      }
      /** Marks a file's key row as owed, for callers that change a file directly. */
      touch(file) {
        this.#dirty.add(file.id);
      }
    };
  }
});

// src/core/scheduler/mutex.ts
var Mutex;
var init_mutex = __esm({
  "src/core/scheduler/mutex.ts"() {
    "use strict";
    Mutex = class {
      #tail = Promise.resolve();
      run(task) {
        const next = this.#tail.then(task);
        this.#tail = next.catch(() => {
        });
        return next;
      }
    };
  }
});

// src/core/scheduler/refinement.ts
async function fetchRunnerPart(context, ledger, revision, content, carried) {
  const { keys, runner } = context;
  const changes = revision.changes;
  const paths = changes.map((c) => c.path);
  const structural = changes.some((c) => c.oldHash === null || c.newHash === null);
  const failures = /* @__PURE__ */ new Map();
  const retrying = ledger.broken;
  const invalidated = await tryRunner(
    context,
    `invalidate (${listPaths(paths)})`,
    () => runner.invalidate(changes.map(toInvalidatedPath)),
    (reason2) => failed(failures, null, reason2)
  );
  const recreated = new Set(invalidated?.recreatedProjects ?? []);
  const environments = recreated.size > 0 || content.environment || retrying ? await tryRunner(
    context,
    "environment",
    () => runner.environment(),
    (reason2) => failed(failures, null, reason2)
  ) : null;
  const listed = structural || recreated.size > 0 || ledger.listingFailed ? await tryRunner(context, "testFiles", () => runner.testFiles()) : void 0;
  const exists = new Set(
    listed ? listed.map(testFileId) : [...ledger.files.values()].map((f) => f.id)
  );
  const reresolve = /* @__PURE__ */ new Map();
  const pick = (refs) => {
    for (const ref of refs) {
      const id = testFileId(ref);
      if (exists.has(id)) reresolve.set(id, ref);
    }
  };
  pick((listed ?? []).filter((ref) => !keys.index.closure(ref)));
  pick(
    [...ledger.files.values()].filter((file) => recreated.has(file.ref.project) || file.blocked !== null).map((file) => file.ref)
  );
  pick(content.rekeyed);
  pick(carried);
  const moved = changes.filter((c) => !keys.isDeclaredInput(c.path));
  pick(closuresToReresolve(moved, keys.index.reverse, keys.isDeclaredInput));
  const affected2 = await tryRunner(
    context,
    `affected (${listPaths(paths)})`,
    () => runner.affected(paths)
  );
  pick(affected2?.direct ?? []);
  pick(affected2?.transitive ?? []);
  const closures = [];
  for (const ref of reresolve.values()) {
    const closure = await tryRunner(
      context,
      `closure of ${ref.path}`,
      () => runner.closure(ref),
      (reason2) => failed(failures, ref.project, reason2)
    );
    if (closure !== null) closures.push(closure);
  }
  return {
    revision,
    retrying,
    failures,
    environments,
    listed,
    direct: new Set((affected2?.direct ?? []).map(testFileId)),
    reresolved: [...reresolve.values()],
    closures
  };
}
async function applyRunnerPart(context, ledger, part, changedMeanwhile) {
  const { keys } = context;
  const changed = new Set(part.revision.changes.map((c) => c.path));
  const touched = /* @__PURE__ */ new Map();
  const touch = (refs) => {
    for (const ref of refs) touched.set(testFileId(ref), ref);
  };
  const touchKeys = (keyChanges) => touch(keyChanges.map((c) => c.testFile));
  if (part.environments !== null) touchKeys(await keys.setEnvironments(part.environments));
  if (part.listed !== void 0) applyListing(context, ledger, part.listed);
  const resolved = [];
  const stale = [];
  for (const closure of part.closures) {
    const ref = closure.testFile;
    if (!ledger.file(ref)) continue;
    touchKeys(keys.setClosure(closure));
    resolved.push(ref);
    if ([ref.path, ...closure.paths].some((path) => changedMeanwhile.has(path))) stale.push(ref);
  }
  touchKeys(await keys.trackUntracked());
  storeClosures(context, resolved);
  touch(part.reresolved);
  ledger.settle(touched.values(), changed, { direct: part.direct });
  settleFailures(ledger, part.failures, part.retrying, changed);
  return stale;
}
var init_refinement = __esm({
  "src/core/scheduler/refinement.ts"() {
    "use strict";
    init_keys();
    init_context();
    init_failures();
    init_notes2();
    init_revision();
  }
});

// src/core/scheduler/status.ts
function statusOf(ledger) {
  const testFiles = counts();
  const checks = counts();
  let running = 0;
  for (const file of ledger?.files.values() ?? []) {
    const validity = classify2(file);
    testFiles[validity]++;
    checks[validity] += file.checks.length;
    if (file.phase === "running") running++;
  }
  const c = ledger?.counters;
  const active = ledger?.checkpoints.active ?? null;
  return {
    revision: ledger?.revision.number ?? 0,
    testFiles,
    checks,
    queued: ledger?.queue.size ?? 0,
    running,
    runs: {
      started: c?.started ?? 0,
      completed: c?.completed ?? 0,
      crashed: c?.crashed ?? 0,
      timedOut: c?.timedOut ?? 0
    },
    lookups: { hits: c?.hits ?? 0, misses: c?.misses ?? 0 },
    discarded: c?.discarded ?? 0,
    checkpoint: active === null ? null : { id: active.record.id, kind: active.record.kind, remaining: active.remaining }
  };
}
function counts() {
  return { current: 0, pending: 0, stale: 0, unknown: 0 };
}
var init_status = __esm({
  "src/core/scheduler/status.ts"() {
    "use strict";
    init_files();
  }
});

// src/core/scheduler/records.ts
function fileCheck(ref) {
  return { kind: "file", project: ref.project, testPath: ref.path };
}
function recordsForFile(input) {
  const { ref, key, report: report2, provenance, describe } = input;
  const inFile = (check) => check.project === ref.project && check.testPath === ref.path;
  const records = [];
  const ran = /* @__PURE__ */ new Set();
  let testsMs = 0;
  for (const result of report2.results) {
    if (!inFile(result.check)) continue;
    ran.add(checkId(result.check));
    testsMs += result.durationMs;
    const failure3 = result.outcome === "fail" ? describe(result.errors, result.location) : { summary: null, fingerprint: null };
    records.push({
      check: result.check,
      key,
      outcome: result.outcome,
      durationMs: result.durationMs,
      location: result.location,
      ...failure3,
      errors: result.errors,
      provenance
    });
  }
  const errors = report2.fileErrors.filter((e) => e.testFile.project === ref.project && e.testFile.path === ref.path).flatMap((e) => e.errors);
  const fileMs = report2.fileDurations?.find(
    (d) => d.testFile.project === ref.project && d.testFile.path === ref.path
  )?.durationMs;
  const outsideTestsMs = fileMs === void 0 ? 0 : Math.max(0, fileMs - testsMs);
  if (errors.length === 0) {
    records.push({
      check: fileCheck(ref),
      key,
      outcome: "pass",
      durationMs: outsideTestsMs,
      location: null,
      summary: null,
      fingerprint: null,
      errors: [],
      provenance
    });
    return records;
  }
  const location2 = errors[0]?.location ?? null;
  const failure2 = describe(errors, location2);
  const failed2 = (check) => ({
    check,
    key,
    outcome: "fail",
    durationMs: 0,
    location: location2,
    ...failure2,
    errors,
    provenance
  });
  for (const check of input.previousChecks) {
    if (check.kind === "test" && inFile(check) && !ran.has(checkId(check))) {
      records.push(failed2(check));
    }
  }
  records.push({ ...failed2(fileCheck(ref)), durationMs: outsideTestsMs });
  return records;
}
var init_records = __esm({
  "src/core/scheduler/records.ts"() {
    "use strict";
    init_files();
  }
});

// src/core/scheduler/stability.ts
function snapshotInputs(cache, paths) {
  const snapshot2 = new StatCache();
  for (const path of paths) {
    const record = cache.get(path);
    if (record) snapshot2.set(record, { racy: cache.isRacy(path) });
    else if (cache.hashOf(path) === null) snapshot2.delete(path);
  }
  return snapshot2;
}
async function changedSince(snapshot2, paths, hasher) {
  const candidates = await statCandidates(paths, hasher);
  const { changes } = await diffCandidates(candidates, snapshot2, hasher);
  return new Set(changes.map((change) => change.path));
}
var init_stability = __esm({
  "src/core/scheduler/stability.ts"() {
    "use strict";
    init_hash();
    init_revision2();
  }
});

// src/core/scheduler/tiers.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { join as join16 } from "node:path";
function selectTier(context, ledger) {
  const { store, keys, policy } = context;
  const picked = [];
  for (const ref of ledger.ordered()) {
    if (picked.length >= policy.runner.tierSize) break;
    const file = ledger.file(ref);
    const key = file?.key ?? null;
    if (!file || key === null || file.blocked !== null) {
      ledger.queue.remove(ref);
      if (file) ledger.touch(file);
      continue;
    }
    if (!ledger.queue.isForced(ref)) {
      const hits = store.results.byKey(key, context.now());
      if (hits.length > 0) {
        ledger.counters.hits++;
        ledger.applyResults(file, key, hits, ledger.checkpoints.idFor(ref));
        continue;
      }
    }
    ledger.queue.remove(ref);
    const checkpointId2 = ledger.checkpoints.idFor(ref);
    picked.push({ file, key, inputs: keys.stabilityPaths(ref), checkpointId: checkpointId2 });
  }
  if (picked.length === 0) {
    ledger.commit();
    return null;
  }
  const checkpointId = picked.find((p) => p.checkpointId !== null)?.checkpointId ?? null;
  const runId = randomUUID3();
  const tier = {
    runId,
    logDir: join16(context.runsDir, runId),
    revision: ledger.revision,
    checkpointId,
    files: picked,
    snapshot: snapshotInputs(
      keys.cache,
      picked.flatMap((p) => p.inputs)
    )
  };
  for (const { file, key } of picked) ledger.setRunning(file, key);
  ledger.tierChanges = /* @__PURE__ */ new Set();
  ledger.counters.started++;
  store.transaction(() => {
    store.runs.start({
      id: runId,
      worktreeId: context.worktreeId,
      revision: tier.revision.number,
      testFiles: picked.map((p) => p.file.ref),
      checkpointId,
      logDir: tier.logDir,
      startedAt: context.now()
    });
    ledger.commit();
  });
  return tier;
}
async function executeTier(context, tier) {
  const started = context.now();
  try {
    return await context.runner.run(
      tier.files.map((f) => f.file.ref),
      { runId: tier.runId, logDir: tier.logDir, timeoutMs: context.policy.runner.timeoutMs }
    );
  } catch (error) {
    return {
      end: "crashed",
      durationMs: context.now() - started,
      completedFiles: [],
      results: [],
      fileErrors: [],
      failure: error instanceof Error ? error.message : String(error)
    };
  }
}
function unstableInputs(context, tier) {
  const inputs2 = new Set(tier.files.flatMap((f) => f.inputs));
  return changedSince(tier.snapshot, inputs2, context.hasher);
}
function recordTier(context, ledger, tier, report2, changedOnDisk) {
  const { store, worktreeId } = context;
  const duringRun = ledger.tierChanges ?? /* @__PURE__ */ new Set();
  ledger.tierChanges = null;
  const completed = new Set(report2.completedFiles.map(testFileId));
  const counters = ledger.counters;
  if (report2.end === "completed") counters.completed++;
  else if (report2.end === "crashed") counters.crashed++;
  else counters.timedOut++;
  const provenance = {
    worktreeId,
    revision: tier.revision.number,
    commit: tier.revision.head,
    dirty: tier.revision.dirty,
    runId: tier.runId,
    recordedAt: context.now()
  };
  const unknown = [];
  store.transaction(() => {
    store.runs.finish(tier.runId, report2.end, context.now());
    for (const { file, key, inputs: inputs2, checkpointId } of tier.files) {
      ledger.setRunning(file, null);
      if (!ledger.files.has(file.id)) continue;
      if (!completed.has(file.id)) {
        unknown.push({ file, key });
        continue;
      }
      if (inputs2.some((path) => changedOnDisk.has(path) || duringRun.has(path))) {
        ledger.discard(file, key);
        continue;
      }
      const previous = file.resultKey;
      const records = recordsForFile({
        ref: file.ref,
        key,
        report: report2,
        previousChecks: previous === null ? [] : store.results.checksForKey(previous),
        provenance,
        describe: context.describe
      });
      if (records.length > 0) store.results.putMany(records);
      if (file.key === key) ledger.applyResults(file, key, records, checkpointId);
    }
    const reason2 = report2.failure ?? `run ${report2.end}`;
    ledger.markUnknown(unknown, reason2);
    ledger.commit();
  });
  return [...changedOnDisk];
}
function queueFullSuite(ledger, force) {
  const id = randomUUID3();
  const files = [...ledger.files.values()];
  const unrunnable = files.filter((file) => file.key === null || file.blocked !== null);
  const runnable = files.filter((file) => file.key !== null && file.blocked === null);
  let requested;
  if (force) {
    requested = runnable;
    for (const file of runnable) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED), true);
  } else {
    const open3 = runnable.filter((file) => classify2(file) !== "current");
    for (const file of open3) file.unknownKey = null;
    const pending = open3.filter((file) => file.phase !== null);
    const misses = ledger.settle(
      open3.filter((file) => file.phase === null).map((file) => file.ref),
      NOTHING_CHANGED,
      { checkpointId: id }
    );
    requested = [...pending, ...misses];
  }
  const record = ledger.checkpoints.start(
    id,
    "run-all",
    ledger.revision.number,
    [...requested, ...unrunnable].map((file) => file.ref),
    force
  );
  for (const file of unrunnable) ledger.checkpoints.failed(file.ref);
  ledger.commit();
  return record;
}
var init_tiers = __esm({
  "src/core/scheduler/tiers.ts"() {
    "use strict";
    init_keys();
    init_context();
    init_files();
    init_queue();
    init_records();
    init_stability();
  }
});

// src/core/scheduler/scheduler.ts
function createScheduler(options) {
  return new TierScheduler(options);
}
var TierScheduler;
var init_scheduler2 = __esm({
  "src/core/scheduler/scheduler.ts"() {
    "use strict";
    init_hash();
    init_keys();
    init_notes();
    init_revision2();
    init_state2();
    init_types();
    init_batch();
    init_bootstrap();
    init_context();
    init_keying();
    init_ledger();
    init_mutex();
    init_queue();
    init_refinement();
    init_revision();
    init_status();
    init_tiers();
    TierScheduler = class {
      constructor(options) {
        this.options = options;
      }
      options;
      #lock = new Mutex();
      #idle = [];
      /** Runner work in arrival order, applied between tiers by the pump. */
      #runnerWork = [];
      /** A refinement is in its runner phase: shifted off `#runnerWork`, not applied yet. */
      #refining = false;
      /** Test files whose closure went stale while a refinement fetched it; the next one resolves them again. */
      #carried = /* @__PURE__ */ new Map();
      #context = null;
      #ledger = null;
      #pumping = null;
      #closed = false;
      /** The pump stopped on an error; idle until the next batch or request. */
      #stalled = false;
      async start() {
        await this.#lock.run(async () => {
          if (this.#context) throw new Error("squeal scheduler: started twice");
          const { options } = this;
          const objectFormat = await readObjectFormat(options.root);
          const hasher = options.hasher ?? createFsHasher(options.root, objectFormat);
          const keys = new WorktreeKeys({
            root: options.root,
            worktreeId: options.worktreeId,
            store: options.store,
            hasher,
            objectFormat,
            policy: options.policy,
            squealVersion: options.squealVersion,
            onExtraFiles: (paths) => options.onExtraFiles?.(paths),
            ...options.env === void 0 ? {} : { env: options.env }
          });
          const context = {
            root: options.root,
            worktreeId: options.worktreeId,
            store: options.store,
            runner: options.runner,
            sink: options.sink,
            policy: options.policy,
            reloadPolicy: options.reloadPolicy ?? (() => null),
            keys,
            hasher,
            runsDir: options.runsDir,
            describe: options.describeFailure ?? describeFailure,
            head: options.head,
            now: options.now ?? Date.now,
            note: (message2) => this.#note(message2)
          };
          const ledger = new Ledger(context);
          this.#ledger = ledger;
          await bootstrap(context, ledger);
          this.#context = context;
        });
        this.#pump();
      }
      /**
       * Stores the revision a batch creates and returns: the revision row, stat
       * cache, content re-key, `queued` phases and known states, in one
       * transaction. The runner part is queued and applied by the pump after the
       * tier in flight, in batch order (`#refine`).
       *
       * Spec 001 D2: "Creating a revision never waits on the runner: the store
       * work [...] completes within the debounce window even while a tier is
       * running, and the runner-dependent refinement is queued behind the tier
       * separately and applied without holding the revision path." Lessons,
       * defect 1: awaiting `runner.invalidate` here, which the runner serializes
       * behind the running tier, let a revision lag the workspace by a whole
       * tier.
       */
      async handleBatch(batch) {
        if (this.#closed) return;
        await this.#lock.run(async () => {
          const { context, ledger } = this.#started();
          const applied = await reconcileBatch(context, ledger, batch);
          if (applied === null) return;
          const { revision, content } = applied;
          this.#runnerWork.push({ run: () => this.#refine(revision, content), cancel: () => {
          } });
        });
        this.#pump();
      }
      /**
       * The runner part of one revision, in two phases (review wave 4.5, S3).
       * The runner phase calls the runner without the lock, so batches are
       * reconciled meanwhile; the apply phase takes the lock, applies what the
       * runner said, and commits it with the revision as refined (D2 as
       * amended). Never rejects: an error is a note, and the revision counts as
       * refined so no wait hangs on it.
       */
      async #refine(revision, content) {
        const { context, ledger } = this.#started();
        this.#refining = true;
        try {
          ledger.refineChanges = /* @__PURE__ */ new Set();
          const carried = [...this.#carried.values()];
          this.#carried.clear();
          const part = await fetchRunnerPart(context, ledger, revision, content, carried);
          await this.#lock.run(async () => {
            const changedMeanwhile = ledger.refineChanges ?? /* @__PURE__ */ new Set();
            ledger.refineChanges = null;
            const stale = await applyRunnerPart(context, ledger, part, changedMeanwhile);
            for (const ref of stale) this.#carried.set(testFileId(ref), ref);
            ledger.commit({ refined: revision.number });
          });
        } catch (error) {
          this.#backgroundError(`could not apply revision ${revision.number}`, error);
          this.#refinedAfterError(revision.number);
        } finally {
          ledger.refineChanges = null;
          this.#refining = false;
        }
      }
      /**
       * Queues the checkpoint at once, unless it needs the runner: while a
       * runner failure is outstanding the runner is retried first, and while a
       * revision waits for its runner part the checkpoint follows it. Both wait
       * for the tier in flight.
       */
      async requestFullSuite(request = {}) {
        const force = request.force === true;
        const record = await this.#lock.run(() => {
          const { ledger } = this.#started();
          if (ledger.broken || this.#runnerWork.length > 0 || this.#refining) return null;
          return queueFullSuite(ledger, force);
        }) ?? await this.#afterTier(async () => {
          const { context, ledger } = this.#started();
          await retryRunner(context, ledger);
          return queueFullSuite(ledger, force);
        });
        this.#pump();
        return record;
      }
      status() {
        return statusOf(this.#ledger);
      }
      idle() {
        if (this.#isIdle()) return Promise.resolve();
        return new Promise((resolve7) => this.#idle.push(resolve7));
      }
      trackedPaths() {
        return this.#context?.keys.cache.paths() ?? [];
      }
      extraFiles() {
        return this.#context?.keys.extraFiles() ?? [];
      }
      async close() {
        if (this.#closed) return;
        this.#closed = true;
        await this.#pumping;
        for (const task of this.#runnerWork.splice(0)) task.cancel();
        await this.#lock.run(() => this.#ledger?.checkpoints.finish("abandoned"));
        for (const resolve7 of this.#idle.splice(0)) resolve7();
      }
      /**
       * Runs tiers one after another until the queue is empty. Selection and
       * recording hold the lock; the run and the stability re-stat do not, so
       * batches are reconciled while a tier is in flight. Spec 001 D5: "A tier in
       * flight is never cancelled by a new revision."
       *
       * Before each tier the runner work queued meanwhile is applied, in arrival
       * order, while no tier holds the runner. A tier is never selected while
       * runner work is pending: its keys would come from a revision the runner
       * has not invalidated yet.
       *
       * An error of a tier stops the pump with a note; the tier's files go back
       * to the queue, and the next batch or request starts the pump again.
       */
      #pump() {
        if (this.#pumping || this.#closed || !this.#ledger) return;
        this.#stalled = false;
        this.#pumping = (async () => {
          let tier = null;
          try {
            while (!this.#closed) {
              await this.#drainRunnerWork();
              if (this.#closed) break;
              const next = await this.#lock.run(() => {
                if (this.#runnerWork.length > 0) return "runner-work";
                const { context: context2, ledger: ledger2 } = this.#started();
                return selectTier(context2, ledger2);
              });
              if (next === "runner-work") continue;
              tier = next;
              if (tier === null) break;
              const { context, ledger } = this.#started();
              const selected = tier;
              const report2 = await executeTier(context, selected);
              const changed = await unstableInputs(context, selected);
              const moved = await this.#lock.run(
                () => recordTier(context, ledger, selected, report2, changed)
              );
              tier = null;
              if (moved.length > 0) await this.#reconcilePaths(moved);
            }
          } catch (error) {
            this.#stalled = true;
            this.#note(`scheduler stopped running tiers: ${String(error)}`);
            this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
            if (tier !== null) await this.#requeue(tier);
          } finally {
            this.#pumping = null;
            if (!this.#closed && !this.#stalled && this.#hasWork()) this.#pump();
            else if (this.#isIdle()) for (const resolve7 of this.#idle.splice(0)) resolve7();
          }
        })();
      }
      /** Applies the queued runner work, oldest first. */
      async #drainRunnerWork() {
        while (!this.#closed) {
          const task = this.#runnerWork.shift();
          if (!task) return;
          await task.run();
        }
      }
      /** Runs `task` under the lock once the tier in flight and the runner work before it are done. */
      #afterTier(task) {
        if (this.#closed) return Promise.reject(new Error("squeal scheduler: closed"));
        return new Promise((resolve7, reject) => {
          this.#runnerWork.push({
            run: () => this.#lock.run(task).then(resolve7, reject),
            cancel: () => reject(new Error("squeal scheduler: closed"))
          });
          this.#pump();
        });
      }
      #hasWork() {
        return this.#runnerWork.length > 0 || (this.#ledger?.queue.size ?? 0) > 0;
      }
      /** Puts the files of a tier that never got recorded back into the queue. */
      async #requeue(tier) {
        await this.#lock.run(() => {
          const { ledger } = this.#started();
          for (const { file } of tier.files) {
            ledger.setRunning(file, null);
            if (ledger.files.has(file.id)) ledger.enqueue(file, priorityOf(file, NOTHING_CHANGED));
          }
          try {
            ledger.commit();
          } catch (error) {
            this.#note(`could not record the re-queued tier: ${String(error)}`);
          }
        });
      }
      async #reconcilePaths(paths) {
        const { context } = this.#started();
        const candidates = await statCandidates(paths, context.hasher);
        await this.handleBatch({ trigger: "watch", paths: candidates });
      }
      #isIdle() {
        if (this.#closed) return true;
        return this.#pumping === null && (this.#stalled || !this.#hasWork());
      }
      #started() {
        if (!this.#context || !this.#ledger) throw new Error("squeal scheduler: not started");
        return { context: this.#context, ledger: this.#ledger };
      }
      /**
       * A refinement that threw is not pending any more: nothing retries it, and
       * its note says what failed. Its revision is recorded as refined, so waits
       * do not wait for it forever (D2 as amended).
       */
      #refinedAfterError(revision) {
        const { store, worktreeId } = this.options;
        try {
          store.transaction(() => {
            const key = refinedMetaKey(worktreeId);
            const previous = Number(store.meta.get(key) ?? Number.NaN);
            if (!(previous >= revision)) store.meta.set(key, String(revision));
          });
        } catch (error) {
          this.#backgroundError(`could not record revision ${revision} as refined`, error);
        }
      }
      /** An error of work no caller awaits: a note for status, and `onError`. */
      #backgroundError(subject, error) {
        this.#note(`${subject}: ${String(error)}`);
        this.options.onError?.(error instanceof Error ? error : new Error(String(error)));
      }
      /** Persists a note for `squeal status` (D7, review S6). */
      #note(message2) {
        const { store, worktreeId, now } = this.options;
        const revision = this.#ledger?.revision.number ?? null;
        try {
          appendNote(store, worktreeId, { at: (now ?? Date.now)(), revision, text: message2 });
        } catch (error) {
          this.options.onError?.(
            new Error(`squeal scheduler: could not persist a note (${message2}): ${String(error)}`)
          );
        }
      }
    };
  }
});

// src/core/scheduler/index.ts
var init_scheduler3 = __esm({
  "src/core/scheduler/index.ts"() {
    "use strict";
    init_files();
    init_revision();
    init_scheduler2();
  }
});

// node_modules/readdirp/index.js
import { lstat as lstat3, readdir as readdir2, realpath, stat as stat2 } from "node:fs/promises";
import { join as pjoin, resolve as presolve, sep as psep } from "node:path";
import { Readable } from "node:stream";
function readdirp(root, options = {}) {
  let type = options.entryType || options.type;
  if (type === "both")
    type = EntryTypes.FILE_DIR_TYPE;
  if (!root) {
    throw new Error("readdirp: root argument is required. Usage: readdirp(root, options)");
  } else if (typeof root !== "string") {
    throw new TypeError("readdirp: root argument must be a string. Usage: readdirp(root, options)");
  } else if (type && !ALL_TYPES.includes(type)) {
    throw new Error(`readdirp: Invalid type passed. Use one of ${ALL_TYPES.join(", ")}`);
  }
  const opts = { ...options, root };
  if (type)
    opts.type = type;
  return new ReaddirpStream(opts);
}
var EntryTypes, defaultOptions, RECURSIVE_ERROR_CODE, NORMAL_FLOW_ERRORS, ALL_TYPES, DIR_TYPES, FILE_TYPES, isNormalFlowError, wantBigintFsStats, emptyFn, normalizeFilter, ReaddirpStream;
var init_readdirp = __esm({
  "node_modules/readdirp/index.js"() {
    EntryTypes = {
      FILE_TYPE: "files",
      DIR_TYPE: "directories",
      FILE_DIR_TYPE: "files_directories",
      EVERYTHING_TYPE: "all"
    };
    defaultOptions = {
      root: ".",
      fileFilter: (_entryInfo) => true,
      directoryFilter: (_entryInfo) => true,
      type: EntryTypes.FILE_TYPE,
      lstat: false,
      depth: 2147483648,
      alwaysStat: false,
      // Throughput is flat from 16 to 65536 (traversal is I/O-bound), but
      // batches of 1024+ entries survive young-gen GC and bloat RSS ~20-60%.
      highWaterMark: 256
    };
    Object.freeze(defaultOptions);
    RECURSIVE_ERROR_CODE = "READDIRP_RECURSIVE_ERROR";
    NORMAL_FLOW_ERRORS = /* @__PURE__ */ new Set(["ENOENT", "EPERM", "EACCES", "ELOOP", RECURSIVE_ERROR_CODE]);
    ALL_TYPES = [
      EntryTypes.DIR_TYPE,
      EntryTypes.EVERYTHING_TYPE,
      EntryTypes.FILE_DIR_TYPE,
      EntryTypes.FILE_TYPE
    ];
    DIR_TYPES = /* @__PURE__ */ new Set([
      EntryTypes.DIR_TYPE,
      EntryTypes.EVERYTHING_TYPE,
      EntryTypes.FILE_DIR_TYPE
    ]);
    FILE_TYPES = /* @__PURE__ */ new Set([
      EntryTypes.EVERYTHING_TYPE,
      EntryTypes.FILE_DIR_TYPE,
      EntryTypes.FILE_TYPE
    ]);
    isNormalFlowError = (error) => NORMAL_FLOW_ERRORS.has(error.code);
    wantBigintFsStats = process.platform === "win32";
    emptyFn = (_entryInfo) => true;
    normalizeFilter = (filter) => {
      if (filter === void 0)
        return emptyFn;
      if (typeof filter === "function")
        return filter;
      if (typeof filter === "string") {
        const fl = filter.trim();
        return (entry2) => entry2.basename === fl;
      }
      if (Array.isArray(filter)) {
        const trItems = filter.map((item) => item.trim());
        return (entry2) => trItems.some((f) => entry2.basename === f);
      }
      return emptyFn;
    };
    ReaddirpStream = class extends Readable {
      /**
       * Directories discovered but not yet emitted from. Listings are read
       * lazily (on pop, plus one prefetch) instead of eagerly on discovery:
       * keeping whole listings for every queued dir balloons RAM on wide trees.
       */
      parents;
      reading;
      parent;
      _stat;
      _maxDepth;
      _wantsDir;
      _wantsFile;
      _wantsEverything;
      _root;
      _isDirent;
      _statsProp;
      _rdOptions;
      _fileFilter;
      _directoryFilter;
      _relStart;
      constructor(options = {}) {
        super({
          objectMode: true,
          autoDestroy: true,
          highWaterMark: options.highWaterMark ?? defaultOptions.highWaterMark
        });
        const opts = { ...defaultOptions, ...options };
        const root = opts.root ?? defaultOptions.root;
        const type = opts.type ?? defaultOptions.type;
        this._fileFilter = normalizeFilter(opts.fileFilter);
        this._directoryFilter = normalizeFilter(opts.directoryFilter);
        const statMethod = opts.lstat ? lstat3 : stat2;
        if (wantBigintFsStats) {
          this._stat = (path) => statMethod(path, { bigint: true });
        } else {
          this._stat = statMethod;
        }
        this._maxDepth = opts.depth != null && Number.isSafeInteger(opts.depth) ? opts.depth : defaultOptions.depth;
        this._wantsDir = DIR_TYPES.has(type);
        this._wantsFile = FILE_TYPES.has(type);
        this._wantsEverything = type === EntryTypes.EVERYTHING_TYPE;
        this._root = presolve(root);
        this._relStart = this._root.endsWith(psep) ? this._root.length : this._root.length + 1;
        this._isDirent = !opts.alwaysStat;
        this._statsProp = this._isDirent ? "dirent" : "stats";
        this._rdOptions = { encoding: "utf8", withFileTypes: this._isDirent };
        const rootDir = { path: this._root, depth: 1 };
        rootDir.pending = this._exploreDir(this._root, 1);
        this.parents = [rootDir];
        this.reading = false;
        this.parent = void 0;
      }
      async _read(batch) {
        if (this.reading)
          return;
        this.reading = true;
        try {
          while (!this.destroyed && batch > 0) {
            const par = this.parent;
            const fil = par && par.files;
            if (fil && fil.length > 0) {
              const { path, depth } = par;
              const slice = fil.splice(0, batch).map((dirent) => this._formatEntry(dirent, path));
              const awaited = this._isDirent ? slice : await Promise.all(slice);
              for (const entry2 of awaited) {
                if (!entry2)
                  continue;
                if (this.destroyed)
                  return;
                let entryType = this._getEntryType(entry2);
                if (typeof entryType !== "string")
                  entryType = await entryType;
                if (entryType === "directory" && this._directoryFilter(entry2)) {
                  if (depth <= this._maxDepth) {
                    this.parents.push({ path: entry2.fullPath, depth: depth + 1 });
                  }
                  if (this._wantsDir) {
                    this.push(entry2);
                    batch--;
                  }
                } else if ((entryType === "file" || this._includeAsFile(entry2)) && this._fileFilter(entry2)) {
                  if (this._wantsFile) {
                    this.push(entry2);
                    batch--;
                  }
                }
              }
            } else {
              const parent = this.parents.pop();
              if (!parent) {
                this.push(null);
                break;
              }
              const dir = parent.pending ?? this._exploreDir(parent.path, parent.depth);
              const next = this.parents[this.parents.length - 1];
              if (next && !next.pending) {
                next.pending = this._exploreDir(next.path, next.depth);
              }
              this.parent = await dir;
              if (this.destroyed)
                return;
            }
          }
        } catch (error) {
          this.destroy(error);
        } finally {
          this.reading = false;
        }
      }
      // NOTE: native `readdir(path, { recursive: true })` was evaluated as a
      // replacement for this per-directory traversal and rejected:
      // - Not faster: node implements it in JS, walking directories sequentially
      //   just like this loop, but with extra path bookkeeping. Benchmarks
      //   (node 24): ~10% slower on wide trees, ~40% slower on small ones,
      //   parity on deep ones.
      // - Much more RAM: it buffers the entire subtree listing in one array,
      //   instead of one directory at a time, defeating streaming.
      // - Semantics diverge: it can't limit depth, can't skip directories a
      //   directoryFilter rejects, doesn't follow symlinked dirs, and fails
      //   wholesale (all entries lost) if anything in the subtree is unreadable,
      //   instead of emitting a 'warn' and continuing.
      async _exploreDir(path, depth) {
        let files;
        try {
          files = await readdir2(path, this._rdOptions);
        } catch (error) {
          this._onError(error);
        }
        return { files, depth, path };
      }
      // Synchronous in dirent mode; returns a promise only when stats are needed.
      _formatEntry(dirent, path) {
        const basename8 = this._isDirent ? dirent.name : dirent;
        const fullPath = pjoin(path, basename8);
        const entry2 = { path: fullPath.slice(this._relStart), fullPath, basename: basename8 };
        if (this._isDirent) {
          entry2.dirent = dirent;
          return entry2;
        }
        return this._stat(fullPath).then((stats) => {
          entry2.stats = stats;
          return entry2;
        }, (err) => {
          this._onError(err);
          return void 0;
        });
      }
      _onError(err) {
        if (isNormalFlowError(err) && !this.destroyed) {
          this.emit("warn", err);
        } else {
          this.destroy(err);
        }
      }
      // Synchronous for regular files and directories; returns a promise only for
      // symlinks, which need realpath() to be classified.
      _getEntryType(entry2) {
        if (!entry2 || !(this._statsProp in entry2)) {
          return "";
        }
        const stats = entry2[this._statsProp];
        if (stats.isFile())
          return "file";
        if (stats.isDirectory())
          return "directory";
        if (stats.isSymbolicLink())
          return this._getSymlinkEntryType(entry2);
        return "";
      }
      async _getSymlinkEntryType(entry2) {
        const full = entry2.fullPath;
        try {
          const entryRealPath = await realpath(full);
          const entryRealPathStats = await lstat3(entryRealPath);
          if (entryRealPathStats.isFile()) {
            return "file";
          }
          if (entryRealPathStats.isDirectory()) {
            const len = entryRealPath.length;
            if (full.startsWith(entryRealPath) && full[len] === psep) {
              const recursiveError = new Error(`Circular symlink detected: "${full}" points to "${entryRealPath}"`);
              recursiveError.code = RECURSIVE_ERROR_CODE;
              this._onError(recursiveError);
              return "";
            }
            return "directory";
          }
        } catch (error) {
          this._onError(error);
        }
        return "";
      }
      _includeAsFile(entry2) {
        const stats = entry2 && entry2[this._statsProp];
        return stats && this._wantsEverything && !stats.isDirectory();
      }
    };
  }
});

// node_modules/chokidar/handler.js
import { watch as fs_watch, unwatchFile, watchFile } from "node:fs";
import { realpath as fsrealpath, lstat as lstat4, open as open2, stat as stat3 } from "node:fs/promises";
import { type as osType } from "node:os";
import * as sp from "node:path";
function createFsWatchInstance(path, options, listener, errHandler, emitRaw) {
  const handleEvent = (rawEvent, evPath) => {
    listener(path);
    emitRaw(rawEvent, evPath, { watchedPath: path });
    if (evPath && path !== evPath) {
      fsWatchBroadcast(sp.resolve(path, evPath), KEY_LISTENERS, sp.join(path, evPath));
    }
  };
  try {
    return fs_watch(path, {
      persistent: options.persistent
    }, handleEvent);
  } catch (error) {
    errHandler(error);
    return void 0;
  }
}
var STR_DATA, STR_END, STR_CLOSE, EMPTY_FN, pl, isWindows, isMacos, isLinux, isFreeBSD, isIBMi, EVENTS, EV, THROTTLE_MODE_WATCH, statMethods, KEY_LISTENERS, KEY_ERR, KEY_RAW, HANDLER_KEYS, binaryExtensions, isBinaryPath, foreach, addAndConvert, clearItem, delFromSet, isEmptySet, FsWatchInstances, fsWatchBroadcast, setFsWatchListener, FsWatchFileInstances, setFsWatchFileListener, NodeFsHandler;
var init_handler = __esm({
  "node_modules/chokidar/handler.js"() {
    STR_DATA = "data";
    STR_END = "end";
    STR_CLOSE = "close";
    EMPTY_FN = () => {
    };
    pl = process.platform;
    isWindows = pl === "win32";
    isMacos = pl === "darwin";
    isLinux = pl === "linux";
    isFreeBSD = pl === "freebsd";
    isIBMi = osType() === "OS400";
    EVENTS = {
      ALL: "all",
      READY: "ready",
      ADD: "add",
      CHANGE: "change",
      ADD_DIR: "addDir",
      UNLINK: "unlink",
      UNLINK_DIR: "unlinkDir",
      RAW: "raw",
      ERROR: "error"
    };
    EV = EVENTS;
    THROTTLE_MODE_WATCH = "watch";
    statMethods = { lstat: lstat4, stat: stat3 };
    KEY_LISTENERS = "listeners";
    KEY_ERR = "errHandlers";
    KEY_RAW = "rawEmitters";
    HANDLER_KEYS = [KEY_LISTENERS, KEY_ERR, KEY_RAW];
    binaryExtensions = /* @__PURE__ */ new Set([
      "3dm",
      "3ds",
      "3g2",
      "3gp",
      "7z",
      "a",
      "aac",
      "adp",
      "afdesign",
      "afphoto",
      "afpub",
      "ai",
      "aif",
      "aiff",
      "alz",
      "ape",
      "apk",
      "appimage",
      "ar",
      "arj",
      "asf",
      "au",
      "avi",
      "bak",
      "baml",
      "bh",
      "bin",
      "bk",
      "bmp",
      "btif",
      "bz2",
      "bzip2",
      "cab",
      "caf",
      "cgm",
      "class",
      "cmx",
      "cpio",
      "cr2",
      "cur",
      "dat",
      "dcm",
      "deb",
      "dex",
      "djvu",
      "dll",
      "dmg",
      "dng",
      "doc",
      "docm",
      "docx",
      "dot",
      "dotm",
      "dra",
      "DS_Store",
      "dsk",
      "dts",
      "dtshd",
      "dvb",
      "dwg",
      "dxf",
      "ecelp4800",
      "ecelp7470",
      "ecelp9600",
      "egg",
      "eol",
      "eot",
      "epub",
      "exe",
      "f4v",
      "fbs",
      "fh",
      "fla",
      "flac",
      "flatpak",
      "fli",
      "flv",
      "fpx",
      "fst",
      "fvt",
      "g3",
      "gh",
      "gif",
      "graffle",
      "gz",
      "gzip",
      "h261",
      "h263",
      "h264",
      "icns",
      "ico",
      "ief",
      "img",
      "ipa",
      "iso",
      "jar",
      "jpeg",
      "jpg",
      "jpgv",
      "jpm",
      "jxr",
      "key",
      "ktx",
      "lha",
      "lib",
      "lvp",
      "lz",
      "lzh",
      "lzma",
      "lzo",
      "m3u",
      "m4a",
      "m4v",
      "mar",
      "mdi",
      "mht",
      "mid",
      "midi",
      "mj2",
      "mka",
      "mkv",
      "mmr",
      "mng",
      "mobi",
      "mov",
      "movie",
      "mp3",
      "mp4",
      "mp4a",
      "mpeg",
      "mpg",
      "mpga",
      "mxu",
      "nef",
      "npx",
      "numbers",
      "nupkg",
      "o",
      "odp",
      "ods",
      "odt",
      "oga",
      "ogg",
      "ogv",
      "otf",
      "ott",
      "pages",
      "pbm",
      "pcx",
      "pdb",
      "pdf",
      "pea",
      "pgm",
      "pic",
      "png",
      "pnm",
      "pot",
      "potm",
      "potx",
      "ppa",
      "ppam",
      "ppm",
      "pps",
      "ppsm",
      "ppsx",
      "ppt",
      "pptm",
      "pptx",
      "psd",
      "pya",
      "pyc",
      "pyo",
      "pyv",
      "qt",
      "rar",
      "ras",
      "raw",
      "resources",
      "rgb",
      "rip",
      "rlc",
      "rmf",
      "rmvb",
      "rpm",
      "rtf",
      "rz",
      "s3m",
      "s7z",
      "scpt",
      "sgi",
      "shar",
      "snap",
      "sil",
      "sketch",
      "slk",
      "smv",
      "snk",
      "so",
      "stl",
      "suo",
      "sub",
      "swf",
      "tar",
      "tbz",
      "tbz2",
      "tga",
      "tgz",
      "thmx",
      "tif",
      "tiff",
      "tlz",
      "ttc",
      "ttf",
      "txz",
      "udf",
      "uvh",
      "uvi",
      "uvm",
      "uvp",
      "uvs",
      "uvu",
      "viv",
      "vob",
      "war",
      "wav",
      "wax",
      "wbmp",
      "wdp",
      "weba",
      "webm",
      "webp",
      "whl",
      "wim",
      "wm",
      "wma",
      "wmv",
      "wmx",
      "woff",
      "woff2",
      "wrm",
      "wvx",
      "xbm",
      "xif",
      "xla",
      "xlam",
      "xls",
      "xlsb",
      "xlsm",
      "xlsx",
      "xlt",
      "xltm",
      "xltx",
      "xm",
      "xmind",
      "xpi",
      "xpm",
      "xwd",
      "xz",
      "z",
      "zip",
      "zipx"
    ]);
    isBinaryPath = (filePath) => binaryExtensions.has(sp.extname(filePath).slice(1).toLowerCase());
    foreach = (val, fn) => {
      if (val instanceof Set) {
        val.forEach(fn);
      } else {
        fn(val);
      }
    };
    addAndConvert = (main2, prop, item) => {
      let container = main2[prop];
      if (!(container instanceof Set)) {
        main2[prop] = container = /* @__PURE__ */ new Set([container]);
      }
      container.add(item);
    };
    clearItem = (cont) => (key) => {
      const set = cont[key];
      if (set instanceof Set) {
        set.clear();
      } else {
        delete cont[key];
      }
    };
    delFromSet = (main2, prop, item) => {
      const container = main2[prop];
      if (container instanceof Set) {
        container.delete(item);
      } else if (container === item) {
        delete main2[prop];
      }
    };
    isEmptySet = (val) => val instanceof Set ? val.size === 0 : !val;
    FsWatchInstances = /* @__PURE__ */ new Map();
    fsWatchBroadcast = (fullPath, listenerType, val1, val2, val3) => {
      const cont = FsWatchInstances.get(fullPath);
      if (!cont)
        return;
      foreach(cont[listenerType], (listener) => {
        listener(val1, val2, val3);
      });
    };
    setFsWatchListener = (path, fullPath, options, handlers) => {
      const { listener, errHandler, rawEmitter } = handlers;
      let cont = FsWatchInstances.get(fullPath);
      let watcher;
      if (!options.persistent) {
        watcher = createFsWatchInstance(path, options, listener, errHandler, rawEmitter);
        if (!watcher)
          return;
        return watcher.close.bind(watcher);
      }
      if (cont) {
        addAndConvert(cont, KEY_LISTENERS, listener);
        addAndConvert(cont, KEY_ERR, errHandler);
        addAndConvert(cont, KEY_RAW, rawEmitter);
      } else {
        watcher = createFsWatchInstance(
          path,
          options,
          fsWatchBroadcast.bind(null, fullPath, KEY_LISTENERS),
          errHandler,
          // no need to use broadcast here
          fsWatchBroadcast.bind(null, fullPath, KEY_RAW)
        );
        if (!watcher)
          return;
        watcher.on(EV.ERROR, async (error) => {
          const broadcastErr = fsWatchBroadcast.bind(null, fullPath, KEY_ERR);
          if (cont)
            cont.watcherUnusable = true;
          if (isWindows && error.code === "EPERM") {
            try {
              const fd = await open2(path, "r");
              await fd.close();
              broadcastErr(error);
            } catch (err) {
            }
          } else {
            broadcastErr(error);
          }
        });
        cont = {
          listeners: listener,
          errHandlers: errHandler,
          rawEmitters: rawEmitter,
          watcher
        };
        FsWatchInstances.set(fullPath, cont);
      }
      return () => {
        delFromSet(cont, KEY_LISTENERS, listener);
        delFromSet(cont, KEY_ERR, errHandler);
        delFromSet(cont, KEY_RAW, rawEmitter);
        if (isEmptySet(cont.listeners)) {
          cont.watcher.close();
          FsWatchInstances.delete(fullPath);
          HANDLER_KEYS.forEach(clearItem(cont));
          cont.watcher = void 0;
          Object.freeze(cont);
        }
      };
    };
    FsWatchFileInstances = /* @__PURE__ */ new Map();
    setFsWatchFileListener = (path, fullPath, options, handlers) => {
      const { listener, rawEmitter } = handlers;
      let cont = FsWatchFileInstances.get(fullPath);
      const copts = cont && cont.options;
      if (copts && (copts.persistent < options.persistent || copts.interval > options.interval)) {
        unwatchFile(fullPath);
        cont = void 0;
      }
      if (cont) {
        addAndConvert(cont, KEY_LISTENERS, listener);
        addAndConvert(cont, KEY_RAW, rawEmitter);
      } else {
        cont = {
          listeners: listener,
          rawEmitters: rawEmitter,
          options,
          watcher: watchFile(fullPath, options, (curr, prev) => {
            foreach(cont.rawEmitters, (rawEmitter2) => {
              rawEmitter2(EV.CHANGE, fullPath, { curr, prev });
            });
            const currmtime = curr.mtimeMs;
            if (curr.size !== prev.size || currmtime > prev.mtimeMs || currmtime === 0) {
              foreach(cont.listeners, (listener2) => listener2(path, curr));
            }
          })
        };
        FsWatchFileInstances.set(fullPath, cont);
      }
      return () => {
        delFromSet(cont, KEY_LISTENERS, listener);
        delFromSet(cont, KEY_RAW, rawEmitter);
        if (isEmptySet(cont.listeners)) {
          FsWatchFileInstances.delete(fullPath);
          unwatchFile(fullPath);
          cont.options = cont.watcher = void 0;
          Object.freeze(cont);
        }
      };
    };
    NodeFsHandler = class {
      fsw;
      _boundHandleError;
      constructor(fsW) {
        this.fsw = fsW;
        this._boundHandleError = (error) => fsW._handleError(error);
      }
      /**
       * Watch file for changes with fs_watchFile or fs_watch.
       * @param path to file or dir
       * @param listener on fs change
       * @returns closer for the watcher instance
       */
      _watchWithNodeFs(path, listener) {
        const opts = this.fsw.options;
        const directory = sp.dirname(path);
        const basename8 = sp.basename(path);
        const parent = this.fsw._getWatchedDir(directory);
        parent.add(basename8);
        const absolutePath = sp.resolve(path);
        const options = {
          persistent: opts.persistent
        };
        if (!listener)
          listener = EMPTY_FN;
        let closer;
        if (opts.usePolling) {
          const enableBin = opts.interval !== opts.binaryInterval;
          options.interval = enableBin && isBinaryPath(basename8) ? opts.binaryInterval : opts.interval;
          closer = setFsWatchFileListener(path, absolutePath, options, {
            listener,
            rawEmitter: this.fsw._emitRaw
          });
        } else {
          closer = setFsWatchListener(path, absolutePath, options, {
            listener,
            errHandler: this._boundHandleError,
            rawEmitter: this.fsw._emitRaw
          });
        }
        return closer;
      }
      /**
       * Watch a file and emit add event if warranted.
       * @returns closer for the watcher instance
       */
      _handleFile(file, stats, initialAdd) {
        if (this.fsw.closed) {
          return;
        }
        const dirname15 = sp.dirname(file);
        const basename8 = sp.basename(file);
        const parent = this.fsw._getWatchedDir(dirname15);
        let prevStats = stats;
        if (parent.has(basename8))
          return;
        const listener = async (path, newStats) => {
          if (!this.fsw._throttle(THROTTLE_MODE_WATCH, file, 5))
            return;
          if (!newStats || newStats.mtimeMs === 0) {
            try {
              const newStats2 = await stat3(file);
              if (this.fsw.closed)
                return;
              const at = newStats2.atimeMs;
              const mt = newStats2.mtimeMs;
              if (!at || at <= mt || mt !== prevStats.mtimeMs) {
                this.fsw._emit(EV.CHANGE, file, newStats2);
              }
              if ((isMacos || isLinux || isFreeBSD) && prevStats.ino !== newStats2.ino) {
                this.fsw._closeFile(path);
                prevStats = newStats2;
                const closer2 = this._watchWithNodeFs(file, listener);
                if (closer2)
                  this.fsw._addPathCloser(path, closer2);
              } else {
                prevStats = newStats2;
              }
            } catch (error) {
              this.fsw._remove(dirname15, basename8);
            }
          } else if (parent.has(basename8)) {
            const at = newStats.atimeMs;
            const mt = newStats.mtimeMs;
            if (!at || at <= mt || mt !== prevStats.mtimeMs) {
              this.fsw._emit(EV.CHANGE, file, newStats);
            }
            prevStats = newStats;
          }
        };
        const closer = this._watchWithNodeFs(file, listener);
        if (!(initialAdd && this.fsw.options.ignoreInitial) && this.fsw._isntIgnored(file)) {
          if (!this.fsw._throttle(EV.ADD, file, 0))
            return;
          this.fsw._emit(EV.ADD, file, stats);
        }
        return closer;
      }
      /**
       * Handle symlinks encountered while reading a dir.
       * @param entry returned by readdirp
       * @param directory path of dir being read
       * @param path of this item
       * @param item basename of this item
       * @returns true if no more processing is needed for this entry.
       */
      async _handleSymlink(entry2, directory, path, item) {
        if (this.fsw.closed) {
          return;
        }
        const full = entry2.fullPath;
        const dir = this.fsw._getWatchedDir(directory);
        if (!this.fsw.options.followSymlinks) {
          this.fsw._incrReadyCount();
          let linkPath;
          try {
            linkPath = await fsrealpath(path);
          } catch (e) {
            this.fsw._emitReady();
            return true;
          }
          if (this.fsw.closed)
            return;
          if (dir.has(item)) {
            if (this.fsw._symlinkPaths.get(full) !== linkPath) {
              this.fsw._symlinkPaths.set(full, linkPath);
              this.fsw._emit(EV.CHANGE, path, entry2.stats);
            }
          } else {
            dir.add(item);
            this.fsw._symlinkPaths.set(full, linkPath);
            this.fsw._emit(EV.ADD, path, entry2.stats);
          }
          this.fsw._emitReady();
          return true;
        }
        if (this.fsw._symlinkPaths.has(full)) {
          return true;
        }
        this.fsw._symlinkPaths.set(full, true);
      }
      _handleRead(directory, initialAdd, wh, target, dir, depth, throttler) {
        directory = sp.join(directory, "");
        const throttleKey = target ? `${directory}:${target}` : directory;
        throttler = this.fsw._throttle("readdir", throttleKey, 1e3);
        if (!throttler)
          return;
        const previous = this.fsw._getWatchedDir(wh.path);
        const current = /* @__PURE__ */ new Set();
        let stream = this.fsw._readdirp(directory, {
          fileFilter: (entry2) => wh.filterPath(entry2),
          directoryFilter: (entry2) => wh.filterDir(entry2)
        });
        if (!stream)
          return;
        stream.on(STR_DATA, async (entry2) => {
          if (this.fsw.closed) {
            stream = void 0;
            return;
          }
          const item = entry2.path;
          let path = sp.join(directory, item);
          current.add(item);
          if (entry2.stats.isSymbolicLink() && await this._handleSymlink(entry2, directory, path, item)) {
            return;
          }
          if (this.fsw.closed) {
            stream = void 0;
            return;
          }
          if (item === target || !target && !previous.has(item)) {
            this.fsw._incrReadyCount();
            path = sp.join(dir, sp.relative(dir, path));
            this._addToNodeFs(path, initialAdd, wh, depth + 1);
          }
        }).on(EV.ERROR, this._boundHandleError);
        return new Promise((resolve7, reject) => {
          if (!stream)
            return reject();
          stream.once(STR_END, () => {
            if (this.fsw.closed) {
              stream = void 0;
              return;
            }
            const wasThrottled = throttler ? throttler.clear() : false;
            resolve7(void 0);
            previous.getChildren().filter((item) => {
              return item !== directory && !current.has(item);
            }).forEach((item) => {
              this.fsw._remove(directory, item);
            });
            stream = void 0;
            if (wasThrottled)
              this._handleRead(directory, false, wh, target, dir, depth, throttler);
          });
        });
      }
      /**
       * Read directory to add / remove files from `@watched` list and re-read it on change.
       * @param dir fs path
       * @param stats
       * @param initialAdd
       * @param depth relative to user-supplied path
       * @param target child path targeted for watch
       * @param wh Common watch helpers for this path
       * @param realpath
       * @returns closer for the watcher instance.
       */
      async _handleDir(dir, stats, initialAdd, depth, target, wh, realpath3) {
        const parentDir2 = this.fsw._getWatchedDir(sp.dirname(dir));
        const tracked = parentDir2.has(sp.basename(dir));
        if (!(initialAdd && this.fsw.options.ignoreInitial) && !target && !tracked) {
          this.fsw._emit(EV.ADD_DIR, dir, stats);
        }
        parentDir2.add(sp.basename(dir));
        this.fsw._getWatchedDir(dir);
        let throttler;
        let closer;
        const oDepth = this.fsw.options.depth;
        if ((oDepth == null || depth <= oDepth) && !this.fsw._symlinkPaths.has(realpath3)) {
          if (!target) {
            await this._handleRead(dir, initialAdd, wh, target, dir, depth, throttler);
            if (this.fsw.closed)
              return;
          }
          closer = this._watchWithNodeFs(dir, (dirPath, stats2) => {
            if (stats2 && stats2.mtimeMs === 0)
              return;
            this._handleRead(dirPath, false, wh, target, dir, depth, throttler);
          });
        }
        return closer;
      }
      /**
       * Handle added file, directory, or glob pattern.
       * Delegates call to _handleFile / _handleDir after checks.
       * @param path to file or ir
       * @param initialAdd was the file added at watch instantiation?
       * @param priorWh depth relative to user-supplied path
       * @param depth Child path actually targeted for watch
       * @param target Child path actually targeted for watch
       */
      async _addToNodeFs(path, initialAdd, priorWh, depth, target) {
        const ready = this.fsw._emitReady;
        if (this.fsw._isIgnored(path) || this.fsw.closed) {
          ready();
          return false;
        }
        const wh = this.fsw._getWatchHelpers(path);
        if (priorWh) {
          wh.filterPath = (entry2) => priorWh.filterPath(entry2);
          wh.filterDir = (entry2) => priorWh.filterDir(entry2);
        }
        try {
          const stats = await statMethods[wh.statMethod](wh.watchPath);
          if (this.fsw.closed)
            return;
          if (this.fsw._isIgnored(wh.watchPath, stats)) {
            ready();
            return false;
          }
          const follow = this.fsw.options.followSymlinks;
          let closer;
          if (stats.isDirectory()) {
            const absPath = sp.resolve(path);
            const targetPath = follow ? await fsrealpath(path) : path;
            if (this.fsw.closed)
              return;
            closer = await this._handleDir(wh.watchPath, stats, initialAdd, depth, target, wh, targetPath);
            if (this.fsw.closed)
              return;
            if (absPath !== targetPath && targetPath !== void 0) {
              this.fsw._symlinkPaths.set(absPath, targetPath);
            }
          } else if (stats.isSymbolicLink()) {
            const targetPath = follow ? await fsrealpath(path) : path;
            if (this.fsw.closed)
              return;
            const parent = sp.dirname(wh.watchPath);
            this.fsw._getWatchedDir(parent).add(wh.watchPath);
            this.fsw._emit(EV.ADD, wh.watchPath, stats);
            closer = await this._handleDir(parent, stats, initialAdd, depth, path, wh, targetPath);
            if (this.fsw.closed)
              return;
            if (targetPath !== void 0) {
              this.fsw._symlinkPaths.set(sp.resolve(path), targetPath);
            }
          } else {
            closer = this._handleFile(wh.watchPath, stats, initialAdd);
          }
          ready();
          if (closer)
            this.fsw._addPathCloser(path, closer);
          return false;
        } catch (error) {
          if (this.fsw._handleError(error)) {
            ready();
            return path;
          }
        }
      }
    };
  }
});

// node_modules/chokidar/index.js
import { EventEmitter } from "node:events";
import { stat as statcb, Stats } from "node:fs";
import { readdir as readdir3, stat as stat4 } from "node:fs/promises";
import * as sp2 from "node:path";
function arrify(item) {
  return Array.isArray(item) ? item : [item];
}
function createPattern(matcher) {
  if (typeof matcher === "function")
    return matcher;
  if (typeof matcher === "string")
    return (string) => matcher === string;
  if (matcher instanceof RegExp)
    return (string) => matcher.test(string);
  if (typeof matcher === "object" && matcher !== null) {
    return (string) => {
      if (matcher.path === string)
        return true;
      if (matcher.recursive) {
        const relative4 = sp2.relative(matcher.path, string);
        if (!relative4) {
          return false;
        }
        return !relative4.startsWith("..") && !sp2.isAbsolute(relative4);
      }
      return false;
    };
  }
  return () => false;
}
function normalizePath(path) {
  if (typeof path !== "string")
    throw new Error("string expected");
  path = sp2.normalize(path);
  path = path.replace(/\\/g, "/");
  let prepend = false;
  if (path.startsWith("//"))
    prepend = true;
  path = path.replace(DOUBLE_SLASH_RE, "/");
  if (prepend)
    path = "/" + path;
  return path;
}
function matchPatterns(patterns, testString, stats) {
  const path = normalizePath(testString);
  for (let index = 0; index < patterns.length; index++) {
    const pattern = patterns[index];
    if (pattern(path, stats)) {
      return true;
    }
  }
  return false;
}
function anymatch(matchers, testString) {
  if (matchers == null) {
    throw new TypeError("anymatch: specify first argument");
  }
  const matchersArray = arrify(matchers);
  const patterns = matchersArray.map((matcher) => createPattern(matcher));
  if (testString == null) {
    return (testString2, stats) => {
      return matchPatterns(patterns, testString2, stats);
    };
  }
  return matchPatterns(patterns, testString);
}
function watch(paths, options = {}) {
  const watcher = new FSWatcher(options);
  watcher.add(paths);
  return watcher;
}
var SLASH, SLASH_SLASH, ONE_DOT, TWO_DOTS, STRING_TYPE, BACK_SLASH_RE, DOUBLE_SLASH_RE, DOT_RE, REPLACER_RE, isMatcherObject, unifyPaths, toUnix, normalizePathToUnix, normalizeIgnored, getAbsolutePath, EMPTY_SET, DirEntry, STAT_METHOD_F, STAT_METHOD_L, WatchHelper, FSWatcher;
var init_chokidar = __esm({
  "node_modules/chokidar/index.js"() {
    init_readdirp();
    init_handler();
    SLASH = "/";
    SLASH_SLASH = "//";
    ONE_DOT = ".";
    TWO_DOTS = "..";
    STRING_TYPE = "string";
    BACK_SLASH_RE = /\\/g;
    DOUBLE_SLASH_RE = /\/\//g;
    DOT_RE = /\..*\.(sw[px])$|~$|\.subl.*\.tmp/;
    REPLACER_RE = /^\.[/\\]/;
    isMatcherObject = (matcher) => typeof matcher === "object" && matcher !== null && !(matcher instanceof RegExp);
    unifyPaths = (paths_) => {
      const paths = arrify(paths_).flat();
      if (!paths.every((p) => typeof p === STRING_TYPE)) {
        throw new TypeError(`Non-string provided as watch path: ${paths}`);
      }
      return paths.map(normalizePathToUnix);
    };
    toUnix = (string) => {
      let str2 = string.replace(BACK_SLASH_RE, SLASH);
      let prepend = false;
      if (str2.startsWith(SLASH_SLASH)) {
        prepend = true;
      }
      str2 = str2.replace(DOUBLE_SLASH_RE, SLASH);
      if (prepend) {
        str2 = SLASH + str2;
      }
      return str2;
    };
    normalizePathToUnix = (path) => toUnix(sp2.normalize(toUnix(path)));
    normalizeIgnored = (cwd = "") => (path) => {
      if (typeof path === "string") {
        return normalizePathToUnix(sp2.isAbsolute(path) ? path : sp2.join(cwd, path));
      } else {
        return path;
      }
    };
    getAbsolutePath = (path, cwd) => {
      if (sp2.isAbsolute(path)) {
        return path;
      }
      return sp2.join(cwd, path);
    };
    EMPTY_SET = Object.freeze(/* @__PURE__ */ new Set());
    DirEntry = class {
      path;
      _removeWatcher;
      items;
      constructor(dir, removeWatcher) {
        this.path = dir;
        this._removeWatcher = removeWatcher;
        this.items = /* @__PURE__ */ new Set();
      }
      add(item) {
        const { items } = this;
        if (!items)
          return;
        if (item !== ONE_DOT && item !== TWO_DOTS)
          items.add(item);
      }
      async remove(item) {
        const { items } = this;
        if (!items)
          return;
        items.delete(item);
        if (items.size > 0)
          return;
        const dir = this.path;
        try {
          await readdir3(dir);
        } catch (err) {
          if (this._removeWatcher) {
            this._removeWatcher(sp2.dirname(dir), sp2.basename(dir));
          }
        }
      }
      has(item) {
        const { items } = this;
        if (!items)
          return;
        return items.has(item);
      }
      getChildren() {
        const { items } = this;
        if (!items)
          return [];
        return [...items.values()];
      }
      dispose() {
        this.items.clear();
        this.path = "";
        this._removeWatcher = EMPTY_FN;
        this.items = EMPTY_SET;
        Object.freeze(this);
      }
    };
    STAT_METHOD_F = "stat";
    STAT_METHOD_L = "lstat";
    WatchHelper = class {
      fsw;
      path;
      watchPath;
      fullWatchPath;
      dirParts;
      followSymlinks;
      statMethod;
      constructor(path, follow, fsw) {
        this.fsw = fsw;
        const watchPath = path;
        this.path = path = path.replace(REPLACER_RE, "");
        this.watchPath = watchPath;
        this.fullWatchPath = sp2.resolve(watchPath);
        this.dirParts = [];
        this.dirParts.forEach((parts) => {
          if (parts.length > 1)
            parts.pop();
        });
        this.followSymlinks = follow;
        this.statMethod = follow ? STAT_METHOD_F : STAT_METHOD_L;
      }
      entryPath(entry2) {
        return sp2.join(this.watchPath, sp2.relative(this.watchPath, entry2.fullPath));
      }
      filterPath(entry2) {
        const { stats } = entry2;
        if (stats && stats.isSymbolicLink())
          return this.filterDir(entry2);
        const resolvedPath = this.entryPath(entry2);
        return this.fsw._isntIgnored(resolvedPath, stats) && this.fsw._hasReadPermissions(stats);
      }
      filterDir(entry2) {
        return this.fsw._isntIgnored(this.entryPath(entry2), entry2.stats);
      }
    };
    FSWatcher = class extends EventEmitter {
      closed;
      options;
      _closers;
      _ignoredPaths;
      _throttled;
      _streams;
      _symlinkPaths;
      _watched;
      _pendingWrites;
      _pendingUnlinks;
      _readyCount;
      _emitReady;
      _closePromise;
      _userIgnored;
      _readyEmitted;
      _emitRaw;
      _boundRemove;
      _nodeFsHandler;
      // Not indenting methods for history sake; for now.
      constructor(_opts = {}) {
        super();
        this.closed = false;
        this._closers = /* @__PURE__ */ new Map();
        this._ignoredPaths = /* @__PURE__ */ new Set();
        this._throttled = /* @__PURE__ */ new Map();
        this._streams = /* @__PURE__ */ new Set();
        this._symlinkPaths = /* @__PURE__ */ new Map();
        this._watched = /* @__PURE__ */ new Map();
        this._pendingWrites = /* @__PURE__ */ new Map();
        this._pendingUnlinks = /* @__PURE__ */ new Map();
        this._readyCount = 0;
        this._readyEmitted = false;
        const awf = _opts.awaitWriteFinish;
        const DEF_AWF = { stabilityThreshold: 2e3, pollInterval: 100 };
        const opts = {
          // Defaults
          persistent: true,
          ignoreInitial: false,
          ignorePermissionErrors: false,
          interval: 100,
          binaryInterval: 300,
          followSymlinks: true,
          usePolling: false,
          // useAsync: false,
          atomic: true,
          // NOTE: overwritten later (depends on usePolling)
          ..._opts,
          // Change format
          ignored: _opts.ignored ? arrify(_opts.ignored) : arrify([]),
          awaitWriteFinish: awf === true ? DEF_AWF : typeof awf === "object" ? { ...DEF_AWF, ...awf } : false
        };
        if (isIBMi)
          opts.usePolling = true;
        if (opts.atomic === void 0)
          opts.atomic = !opts.usePolling;
        const envPoll = process.env.CHOKIDAR_USEPOLLING;
        if (envPoll !== void 0) {
          const envLower = envPoll.toLowerCase();
          if (envLower === "false" || envLower === "0")
            opts.usePolling = false;
          else if (envLower === "true" || envLower === "1")
            opts.usePolling = true;
          else
            opts.usePolling = !!envLower;
        }
        const envInterval = process.env.CHOKIDAR_INTERVAL;
        if (envInterval)
          opts.interval = Number.parseInt(envInterval, 10);
        let readyCalls = 0;
        this._emitReady = () => {
          readyCalls++;
          if (readyCalls >= this._readyCount) {
            this._emitReady = EMPTY_FN;
            this._readyEmitted = true;
            process.nextTick(() => this.emit(EVENTS.READY));
          }
        };
        this._emitRaw = (...args) => this.emit(EVENTS.RAW, ...args);
        this._boundRemove = this._remove.bind(this);
        this.options = opts;
        this._nodeFsHandler = new NodeFsHandler(this);
        Object.freeze(opts);
      }
      _addIgnoredPath(matcher) {
        if (isMatcherObject(matcher)) {
          for (const ignored of this._ignoredPaths) {
            if (isMatcherObject(ignored) && ignored.path === matcher.path && ignored.recursive === matcher.recursive) {
              return;
            }
          }
        }
        this._ignoredPaths.add(matcher);
      }
      _removeIgnoredPath(matcher) {
        this._ignoredPaths.delete(matcher);
        if (typeof matcher === "string") {
          for (const ignored of this._ignoredPaths) {
            if (isMatcherObject(ignored) && ignored.path === matcher) {
              this._ignoredPaths.delete(ignored);
            }
          }
        }
      }
      // Public methods
      /**
       * Adds paths to be watched on an existing FSWatcher instance.
       * @param paths_ file or file list. Other arguments are unused
       */
      add(paths_, _origAdd, _internal) {
        const { cwd } = this.options;
        this.closed = false;
        this._closePromise = void 0;
        let paths = unifyPaths(paths_);
        if (cwd) {
          paths = paths.map((path) => {
            const absPath = getAbsolutePath(path, cwd);
            return absPath;
          });
        }
        paths.forEach((path) => {
          this._removeIgnoredPath(path);
        });
        this._userIgnored = void 0;
        if (!this._readyCount)
          this._readyCount = 0;
        this._readyCount += paths.length;
        Promise.all(paths.map(async (path) => {
          const res = await this._nodeFsHandler._addToNodeFs(path, !_internal, void 0, 0, _origAdd);
          if (res)
            this._emitReady();
          return res;
        })).then((results2) => {
          if (this.closed)
            return;
          results2.forEach((item) => {
            if (item)
              this.add(sp2.dirname(item), sp2.basename(_origAdd || item));
          });
        });
        return this;
      }
      /**
       * Close watchers or start ignoring events from specified paths.
       */
      unwatch(paths_) {
        if (this.closed)
          return this;
        const paths = unifyPaths(paths_);
        const { cwd } = this.options;
        paths.forEach((path) => {
          if (!sp2.isAbsolute(path) && !this._closers.has(path)) {
            if (cwd)
              path = sp2.join(cwd, path);
            path = sp2.resolve(path);
          }
          this._closePath(path);
          this._addIgnoredPath(path);
          if (this._watched.has(path)) {
            this._addIgnoredPath({
              path,
              recursive: true
            });
          }
          this._userIgnored = void 0;
        });
        return this;
      }
      /**
       * Close watchers and remove all listeners from watched paths.
       */
      close() {
        if (this._closePromise) {
          return this._closePromise;
        }
        this.closed = true;
        this.removeAllListeners();
        const closers = [];
        this._closers.forEach((closerList) => closerList.forEach((closer) => {
          const promise = closer();
          if (promise instanceof Promise)
            closers.push(promise);
        }));
        this._streams.forEach((stream) => stream.destroy());
        this._userIgnored = void 0;
        this._readyCount = 0;
        this._readyEmitted = false;
        this._watched.forEach((dirent) => dirent.dispose());
        this._closers.clear();
        this._watched.clear();
        this._streams.clear();
        this._symlinkPaths.clear();
        this._throttled.clear();
        this._closePromise = closers.length ? Promise.all(closers).then(() => void 0) : Promise.resolve();
        return this._closePromise;
      }
      /**
       * Expose list of watched paths
       * @returns for chaining
       */
      getWatched() {
        const watchList = {};
        this._watched.forEach((entry2, dir) => {
          const key = this.options.cwd ? sp2.relative(this.options.cwd, dir) : dir;
          const index = key || ONE_DOT;
          watchList[index] = entry2.getChildren().sort();
        });
        return watchList;
      }
      emitWithAll(event, args) {
        this.emit(event, ...args);
        if (event !== EVENTS.ERROR)
          this.emit(EVENTS.ALL, event, ...args);
      }
      // Common helpers
      // --------------
      /**
       * Normalize and emit events.
       * Calling _emit DOES NOT MEAN emit() would be called!
       * @param event Type of event
       * @param path File or directory path
       * @param stats arguments to be passed with event
       * @returns the error if defined, otherwise the value of the FSWatcher instance's `closed` flag
       */
      async _emit(event, path, stats) {
        if (this.closed)
          return;
        const opts = this.options;
        if (isWindows)
          path = sp2.normalize(path);
        if (opts.cwd)
          path = sp2.relative(opts.cwd, path);
        const args = [path];
        if (stats != null)
          args.push(stats);
        const awf = opts.awaitWriteFinish;
        let pw;
        if (awf && (pw = this._pendingWrites.get(path))) {
          pw.lastChange = /* @__PURE__ */ new Date();
          return this;
        }
        if (opts.atomic) {
          if (event === EVENTS.UNLINK) {
            this._pendingUnlinks.set(path, [event, ...args]);
            setTimeout(() => {
              this._pendingUnlinks.forEach((entry2, path2) => {
                this.emit(...entry2);
                this.emit(EVENTS.ALL, ...entry2);
                this._pendingUnlinks.delete(path2);
              });
            }, typeof opts.atomic === "number" ? opts.atomic : 100);
            return this;
          }
          if (event === EVENTS.ADD && this._pendingUnlinks.has(path)) {
            event = EVENTS.CHANGE;
            this._pendingUnlinks.delete(path);
          }
        }
        if (awf && (event === EVENTS.ADD || event === EVENTS.CHANGE) && this._readyEmitted) {
          const awfEmit = (err, stats2) => {
            if (err) {
              event = EVENTS.ERROR;
              args[0] = err;
              this.emitWithAll(event, args);
            } else if (stats2) {
              if (args.length > 1) {
                args[1] = stats2;
              } else {
                args.push(stats2);
              }
              this.emitWithAll(event, args);
            }
          };
          this._awaitWriteFinish(path, awf.stabilityThreshold, event, awfEmit);
          return this;
        }
        if (event === EVENTS.CHANGE) {
          const isThrottled = !this._throttle(EVENTS.CHANGE, path, 50);
          if (isThrottled)
            return this;
        }
        if (opts.alwaysStat && stats === void 0 && (event === EVENTS.ADD || event === EVENTS.ADD_DIR || event === EVENTS.CHANGE)) {
          const fullPath = opts.cwd ? sp2.join(opts.cwd, path) : path;
          let stats2;
          try {
            stats2 = await stat4(fullPath);
          } catch (err) {
          }
          if (!stats2 || this.closed)
            return;
          args.push(stats2);
        }
        this.emitWithAll(event, args);
        return this;
      }
      /**
       * Common handler for errors
       * @returns The error if defined, otherwise the value of the FSWatcher instance's `closed` flag
       */
      _handleError(error) {
        const code = error && error.code;
        if (error && code !== "ENOENT" && code !== "ENOTDIR" && (!this.options.ignorePermissionErrors || code !== "EPERM" && code !== "EACCES")) {
          this.emit(EVENTS.ERROR, error);
        }
        return error || this.closed;
      }
      /**
       * Helper utility for throttling
       * @param actionType type being throttled
       * @param path being acted upon
       * @param timeout duration of time to suppress duplicate actions
       * @returns tracking object or false if action should be suppressed
       */
      _throttle(actionType, path, timeout) {
        if (!this._throttled.has(actionType)) {
          this._throttled.set(actionType, /* @__PURE__ */ new Map());
        }
        const action = this._throttled.get(actionType);
        if (!action)
          throw new Error("invalid throttle");
        const actionPath = action.get(path);
        if (actionPath) {
          actionPath.count++;
          return false;
        }
        let timeoutObject;
        const clear = () => {
          const item = action.get(path);
          const count = item ? item.count : 0;
          action.delete(path);
          clearTimeout(timeoutObject);
          if (item)
            clearTimeout(item.timeoutObject);
          return count;
        };
        timeoutObject = setTimeout(clear, timeout);
        const thr = { timeoutObject, clear, count: 0 };
        action.set(path, thr);
        return thr;
      }
      _incrReadyCount() {
        return this._readyCount++;
      }
      /**
       * Awaits write operation to finish.
       * Polls a newly created file for size variations. When files size does not change for 'threshold' milliseconds calls callback.
       * @param path being acted upon
       * @param threshold Time in milliseconds a file size must be fixed before acknowledging write OP is finished
       * @param event
       * @param awfEmit Callback to be called when ready for event to be emitted.
       */
      _awaitWriteFinish(path, threshold, event, awfEmit) {
        const awf = this.options.awaitWriteFinish;
        if (typeof awf !== "object")
          return;
        const pollInterval = awf.pollInterval;
        let timeoutHandler;
        let fullPath = path;
        if (this.options.cwd && !sp2.isAbsolute(path)) {
          fullPath = sp2.join(this.options.cwd, path);
        }
        const now = /* @__PURE__ */ new Date();
        const writes = this._pendingWrites;
        function awaitWriteFinishFn(prevStat) {
          statcb(fullPath, (err, curStat) => {
            if (err || !writes.has(path)) {
              if (err && err.code !== "ENOENT")
                awfEmit(err);
              return;
            }
            const now2 = Number(/* @__PURE__ */ new Date());
            if (prevStat && curStat.size !== prevStat.size) {
              writes.get(path).lastChange = now2;
            }
            const pw = writes.get(path);
            const df = now2 - pw.lastChange;
            if (df >= threshold) {
              writes.delete(path);
              awfEmit(void 0, curStat);
            } else {
              timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval, curStat);
            }
          });
        }
        if (!writes.has(path)) {
          writes.set(path, {
            lastChange: now,
            cancelWait: () => {
              writes.delete(path);
              clearTimeout(timeoutHandler);
              return event;
            }
          });
          timeoutHandler = setTimeout(awaitWriteFinishFn, pollInterval);
        }
      }
      /**
       * Determines whether user has asked to ignore this path.
       */
      _isIgnored(path, stats) {
        if (this.options.atomic && DOT_RE.test(path))
          return true;
        if (!this._userIgnored) {
          const { cwd } = this.options;
          const ign = this.options.ignored;
          const ignored = (ign || []).map(normalizeIgnored(cwd));
          const ignoredPaths = [...this._ignoredPaths];
          const list = [...ignoredPaths.map(normalizeIgnored(cwd)), ...ignored];
          this._userIgnored = anymatch(list, void 0);
        }
        return this._userIgnored(path, stats);
      }
      _isntIgnored(path, stat5) {
        return !this._isIgnored(path, stat5);
      }
      /**
       * Provides a set of common helpers and properties relating to symlink handling.
       * @param path file or directory pattern being watched
       */
      _getWatchHelpers(path) {
        return new WatchHelper(path, this.options.followSymlinks, this);
      }
      // Directory helpers
      // -----------------
      /**
       * Provides directory tracking objects
       * @param directory path of the directory
       */
      _getWatchedDir(directory) {
        const dir = sp2.resolve(directory);
        if (!this._watched.has(dir))
          this._watched.set(dir, new DirEntry(dir, this._boundRemove));
        return this._watched.get(dir);
      }
      // File helpers
      // ------------
      /**
       * Check for read permissions: https://stackoverflow.com/a/11781404/1358405
       */
      _hasReadPermissions(stats) {
        if (this.options.ignorePermissionErrors)
          return true;
        return Boolean(Number(stats.mode) & 256);
      }
      /**
       * Handles emitting unlink events for
       * files and directories, and via recursion, for
       * files and directories within directories that are unlinked
       * @param directory within which the following item is located
       * @param item      base path of item/directory
       */
      _remove(directory, item, isDirectory) {
        const path = sp2.join(directory, item);
        const fullPath = sp2.resolve(path);
        isDirectory = isDirectory != null ? isDirectory : this._watched.has(path) || this._watched.has(fullPath);
        if (!this._throttle("remove", path, 100))
          return;
        if (!isDirectory && this._watched.size === 1) {
          this.add(directory, item, true);
        }
        const wp = this._getWatchedDir(path);
        const nestedDirectoryChildren = wp.getChildren();
        nestedDirectoryChildren.forEach((nested) => this._remove(path, nested));
        const parent = this._getWatchedDir(directory);
        const wasTracked = parent.has(item);
        parent.remove(item);
        if (this._symlinkPaths.has(fullPath)) {
          this._symlinkPaths.delete(fullPath);
        }
        let relPath = path;
        if (this.options.cwd)
          relPath = sp2.relative(this.options.cwd, path);
        if (this.options.awaitWriteFinish && this._pendingWrites.has(relPath)) {
          const event = this._pendingWrites.get(relPath).cancelWait();
          if (event === EVENTS.ADD)
            return;
        }
        this._watched.delete(path);
        this._watched.delete(fullPath);
        const eventName = isDirectory ? EVENTS.UNLINK_DIR : EVENTS.UNLINK;
        if (wasTracked && !this._isIgnored(path))
          this._emit(eventName, path);
        this._closePath(path);
      }
      /**
       * Closes all watchers for a path
       */
      _closePath(path) {
        this._closeFile(path);
        const dir = sp2.dirname(path);
        this._getWatchedDir(dir).remove(sp2.basename(path));
      }
      /**
       * Closes only file-specific watchers
       */
      _closeFile(path) {
        const closers = this._closers.get(path);
        if (!closers)
          return;
        closers.forEach((closer) => closer());
        this._closers.delete(path);
      }
      _addPathCloser(path, closer) {
        if (!closer)
          return;
        let list = this._closers.get(path);
        if (!list) {
          list = [];
          this._closers.set(path, list);
        }
        list.push(closer);
      }
      _readdirp(root, opts) {
        if (this.closed)
          return;
        const options = { type: EVENTS.ALL, alwaysStat: true, lstat: true, ...opts, depth: 0 };
        let stream = readdirp(root, options);
        this._streams.add(stream);
        stream.once(STR_CLOSE, () => {
          stream = void 0;
        });
        stream.once(STR_END, () => {
          if (stream) {
            this._streams.delete(stream);
            stream = void 0;
          }
        });
        return stream;
      }
    };
  }
});

// src/core/watcher/exclusions.ts
import { dirname as dirname10 } from "node:path";
var Exclusions;
var init_exclusions = __esm({
  "src/core/watcher/exclusions.ts"() {
    "use strict";
    Exclusions = class {
      constructor(spec) {
        this.spec = spec;
        this.excluded = new Set(spec.excluded);
        this.extra = new Set(spec.extraFiles);
      }
      spec;
      excluded;
      extra;
      excludes(path) {
        if (this.extra.has(path)) return false;
        const { root } = this.spec;
        let current = path;
        while (current.length > root.length) {
          if (this.excluded.has(current)) return true;
          const parent = dirname10(current);
          if (parent === current) break;
          current = parent;
        }
        return false;
      }
    };
  }
});

// src/core/watcher/chokidar-backend.ts
var KINDS2, chokidarBackend;
var init_chokidar_backend = __esm({
  "src/core/watcher/chokidar-backend.ts"() {
    "use strict";
    init_chokidar();
    init_exclusions();
    KINDS2 = {
      add: "add",
      addDir: "add",
      change: "change",
      unlink: "unlink",
      unlinkDir: "unlink"
    };
    chokidarBackend = {
      name: "chokidar",
      async watch(spec, listener) {
        let current = spec;
        let exclusions = new Exclusions(spec);
        const watcher = watch([spec.root, ...spec.extraFiles], {
          ignored: (path) => exclusions.excludes(path),
          ignoreInitial: true,
          persistent: true,
          followSymlinks: false,
          atomic: false
        });
        watcher.on("all", (event, path) => {
          const kind = KINDS2[event];
          if (kind) listener.onHints([{ path, kind }]);
        });
        watcher.on("error", (error) => {
          listener.onError(error instanceof Error ? error : new Error(String(error)));
        });
        await new Promise((resolve7) => watcher.once("ready", () => resolve7()));
        return {
          async update(next) {
            const before = current;
            current = next;
            exclusions = new Exclusions(next);
            const nowExcluded = next.excluded.filter((p) => !before.excluded.includes(p));
            const noLongerExcluded = before.excluded.filter((p) => !next.excluded.includes(p));
            const newExtra = next.extraFiles.filter((p) => !before.extraFiles.includes(p));
            if (nowExcluded.length > 0) watcher.unwatch(nowExcluded);
            if (noLongerExcluded.length > 0 || newExtra.length > 0) {
              watcher.add([...noLongerExcluded, ...newExtra]);
            }
          },
          close: () => watcher.close()
        };
      }
    };
  }
});

// src/core/watcher/parcel-backend.ts
import { dirname as dirname11 } from "node:path";
async function loadOwnParcel() {
  try {
    return (await import("@parcel/watcher")).default;
  } catch (error) {
    const reason2 = error instanceof Error ? error.message : String(error);
    throw new Error(
      `squeal: @parcel/watcher, the macOS watcher backend, could not be loaded. It is an optional dependency; reinstall with optional dependencies enabled. ${reason2}`
    );
  }
}
function createParcelBackend(load) {
  return {
    name: "parcel",
    async watch(spec, listener) {
      const parcel = await load(spec.root);
      let subs = await subscribeAll(parcel, spec, listener);
      return {
        async update(next) {
          const old = subs;
          subs = await subscribeAll(parcel, next, listener);
          await Promise.all(old.map((s) => s.unsubscribe()));
        },
        async close() {
          await Promise.all(subs.map((s) => s.unsubscribe()));
          subs = [];
        }
      };
    }
  };
}
async function subscribeAll(parcel, spec, listener) {
  const exclusions = new Exclusions(spec);
  const main2 = await parcel.subscribe(
    spec.root,
    callback(listener, (path) => !exclusions.excludes(path)),
    { ignore: [...spec.excluded] }
  );
  const subs = [main2];
  const withoutExtras = new Exclusions({ ...spec, extraFiles: [] });
  const hidden = /* @__PURE__ */ new Map();
  for (const file of spec.extraFiles) {
    if (!withoutExtras.excludes(file)) continue;
    const parent = dirname11(file);
    hidden.set(parent, (hidden.get(parent) ?? /* @__PURE__ */ new Set()).add(file));
  }
  for (const [parent, files] of hidden) {
    try {
      subs.push(
        await parcel.subscribe(
          parent,
          callback(listener, (path) => files.has(path))
        )
      );
    } catch (error) {
      listener.onError(
        new Error(`squeal: cannot watch extra files in ${parent}: ${error.message}`)
      );
    }
  }
  return subs;
}
function callback(listener, keep) {
  return (error, events) => {
    if (error) {
      if (DROPPED.test(error.message)) listener.onDropped(error.message);
      else listener.onError(error);
      return;
    }
    const hints = [];
    for (const event of events) {
      if (keep(event.path)) hints.push({ path: event.path, kind: KINDS3[event.type] });
    }
    if (hints.length > 0) listener.onHints(hints);
  };
}
var KINDS3, DROPPED, parcelBackend;
var init_parcel_backend = __esm({
  "src/core/watcher/parcel-backend.ts"() {
    "use strict";
    init_exclusions();
    KINDS3 = { create: "add", update: "change", delete: "unlink" };
    DROPPED = /re-?scanned|dropped/i;
    parcelBackend = createParcelBackend(() => loadOwnParcel());
  }
});

// src/core/watcher/backend.ts
import { createRequire } from "node:module";
import { join as join19 } from "node:path";
import { pathToFileURL } from "node:url";
function createWatcherBackend(platform) {
  return platform === "darwin" ? createParcelBackend(loadParcel) : chokidarBackend;
}
async function loadParcel(root) {
  try {
    return await loadOwnParcel();
  } catch (own) {
    let resolved;
    try {
      resolved = createRequire(join19(root, "package.json")).resolve("@parcel/watcher");
    } catch {
      throw own;
    }
    return (await import(pathToFileURL(resolved).href)).default;
  }
}
var init_backend = __esm({
  "src/core/watcher/backend.ts"() {
    "use strict";
    init_chokidar_backend();
    init_parcel_backend();
  }
});

// src/core/watcher/concurrency.ts
async function mapConcurrent2(items, fn, limit = STAT_CONCURRENCY) {
  const list = [...items];
  const results2 = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const index = next++;
      results2[index] = await fn(list[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, list.length) }, worker));
  return results2;
}
var STAT_CONCURRENCY;
var init_concurrency2 = __esm({
  "src/core/watcher/concurrency.ts"() {
    "use strict";
    STAT_CONCURRENCY = 64;
  }
});

// src/core/watcher/paths.ts
function* selfAndAncestors(path) {
  let current = path;
  while (true) {
    yield current;
    const slash = current.lastIndexOf("/");
    if (slash < 0) return;
    current = current.slice(0, slash);
  }
}
function isGitMetadata(path) {
  return path === ".git" || path.startsWith(".git/") || path.includes("/.git/") || path.endsWith("/.git");
}
var init_paths3 = __esm({
  "src/core/watcher/paths.ts"() {
    "use strict";
    init_fs();
  }
});

// src/core/watcher/candidates.ts
import { lstat as lstat5, readdir as readdir4 } from "node:fs/promises";
async function candidatesFromHints(ctx, absPaths) {
  const nested = new NestedRepoProbe(ctx.root);
  const relPaths = /* @__PURE__ */ new Set();
  for (const abs of absPaths) {
    const rel = toRelative(ctx.root, abs);
    if (rel === null || isGitMetadata(rel) || ctx.exclusions.excludes(abs)) continue;
    relPaths.add(rel);
  }
  const kept = [];
  for (const rel of relPaths) {
    if (!await nested.isInside(rel)) kept.push(rel);
  }
  const ignored = await checkIgnored(
    ctx.root,
    kept.filter((p) => !ctx.extraFiles.has(p))
  );
  const out = /* @__PURE__ */ new Map();
  const ignoredDirs = [];
  const walked = [];
  let tracked = null;
  const trackedSet = () => {
    tracked ??= new Set(ctx.trackedPaths());
    return tracked;
  };
  for (const rel of kept) {
    const stats = await lstatOrNull2(toAbsolute(ctx.root, rel));
    if (stats?.isDirectory()) {
      if (ignored.has(rel)) ignoredDirs.push(rel);
      else {
        if (trackedSet().has(rel)) out.set(rel, null);
        walked.push(...await walkFiles(ctx, nested, rel));
      }
      continue;
    }
    if (ignored.has(rel)) continue;
    out.set(rel, stats ? toFileStat(stats) : null);
    if (!stats) {
      for (const path of trackedSet()) {
        if (path.startsWith(`${rel}/`)) out.set(path, null);
      }
    }
  }
  const walkedIgnored = await checkIgnored(
    ctx.root,
    walked.filter((p) => !ctx.extraFiles.has(p))
  );
  for (const rel of walked) {
    if (!walkedIgnored.has(rel)) out.set(rel, await statOrNull(ctx.root, rel));
  }
  for (const [rel, stat5] of out) {
    if (stat5 === null) out.set(rel, await statOrNull(ctx.root, rel));
  }
  return { paths: sortCandidates(out), ignoredDirs };
}
async function candidatesForReconcile(ctx, statusPaths) {
  const nested = new NestedRepoProbe(ctx.root);
  const all = /* @__PURE__ */ new Set([...statusPaths, ...ctx.trackedPaths(), ...ctx.extraFiles]);
  const paths = [...all].filter((rel) => !isGitMetadata(rel));
  const stats = await mapConcurrent2(paths, async (rel) => {
    const stats2 = await lstatOrNull2(toAbsolute(ctx.root, rel));
    const probe = stats2?.isDirectory() ? rel : parentDir(rel);
    if (probe !== null && await nested.isInside(probe)) return void 0;
    return stats2 && !stats2.isDirectory() ? toFileStat(stats2) : null;
  });
  const out = /* @__PURE__ */ new Map();
  paths.forEach((rel, i) => {
    const stat5 = stats[i];
    if (stat5 !== void 0) out.set(rel, stat5);
  });
  return sortCandidates(out);
}
async function walkFiles(ctx, nested, dir) {
  const files = [];
  const pending = [dir];
  for (let next = pending.pop(); next !== void 0; next = pending.pop()) {
    let entries;
    try {
      entries = await readdir4(toAbsolute(ctx.root, next), { withFileTypes: true });
    } catch (error) {
      if (isMissing(error)) continue;
      throw error;
    }
    for (const entry2 of entries) {
      if (entry2.name === ".git") continue;
      const rel = `${next}/${entry2.name}`;
      if (ctx.exclusions.excludes(toAbsolute(ctx.root, rel))) continue;
      if (entry2.isDirectory()) {
        if (!await nested.isInside(rel)) pending.push(rel);
      } else {
        files.push(rel);
      }
    }
  }
  return files;
}
async function lstatOrNull2(abs) {
  try {
    return await lstat5(abs);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}
async function statOrNull(root, rel) {
  const stats = await lstatOrNull2(toAbsolute(root, rel));
  return stats && !stats.isDirectory() ? toFileStat(stats) : null;
}
function parentDir(rel) {
  const slash = rel.lastIndexOf("/");
  return slash < 0 ? null : rel.slice(0, slash);
}
function toFileStat(stats) {
  return { mtimeMs: stats.mtimeMs, ctimeMs: stats.ctimeMs, size: stats.size, inode: stats.ino };
}
function sortCandidates(map) {
  return [...map.keys()].sort().map((path) => ({ path, stat: map.get(path) ?? null }));
}
var NestedRepoProbe;
var init_candidates = __esm({
  "src/core/watcher/candidates.ts"() {
    "use strict";
    init_fs();
    init_concurrency2();
    init_git2();
    init_paths3();
    NestedRepoProbe = class {
      constructor(root) {
        this.root = root;
      }
      root;
      cache = /* @__PURE__ */ new Map();
      /** True when `rel`, or a directory above it below the root, holds a `.git` entry. */
      async isInside(rel) {
        for (const dir of selfAndAncestors(rel)) {
          let hit = this.cache.get(dir);
          if (!hit) {
            hit = hasGitEntry(toAbsolute(this.root, dir));
            this.cache.set(dir, hit);
          }
          if (await hit) return true;
        }
        return false;
      }
    };
  }
});

// src/core/watcher/debounce.ts
var Debouncer;
var init_debounce = __esm({
  "src/core/watcher/debounce.ts"() {
    "use strict";
    Debouncer = class {
      constructor(onFlush, timings) {
        this.onFlush = onFlush;
        this.timings = timings;
      }
      onFlush;
      timings;
      items = [];
      quietTimer = null;
      maxTimer = null;
      get pending() {
        return this.items.length > 0;
      }
      push(items) {
        const before = this.items.length;
        for (const item of items) this.items.push(item);
        if (this.items.length === before) return;
        if (this.quietTimer) clearTimeout(this.quietTimer);
        this.quietTimer = setTimeout(() => this.flush(), this.timings.quietMs);
        this.maxTimer ??= setTimeout(() => this.flush(), this.timings.maxBatchMs);
      }
      flush() {
        const items = this.items;
        this.cancel();
        if (items.length > 0) this.onFlush(items);
      }
      cancel() {
        if (this.quietTimer) clearTimeout(this.quietTimer);
        if (this.maxTimer) clearTimeout(this.maxTimer);
        this.quietTimer = null;
        this.maxTimer = null;
        this.items = [];
      }
    };
  }
});

// src/core/watcher/watch-spec.ts
async function buildWatchSpec(root, extraFiles = [], status2) {
  const [ignoredEntries, gitState, submodules] = await Promise.all([
    listIgnored(root),
    status2 ?? gitStatus(root),
    listSubmodules(root)
  ]);
  const dirs = ignoredEntries.filter((e) => e.endsWith("/")).map((e) => e.slice(0, -1));
  const ignoredDirs = await checkIgnored(root, dirs);
  const excluded = /* @__PURE__ */ new Set([".git"]);
  for (const entry2 of ignoredEntries) {
    if (!entry2.endsWith("/")) excluded.add(entry2);
  }
  for (const dir of dirs) {
    if (ignoredDirs.has(dir)) excluded.add(dir);
  }
  for (const dir of gitState.nestedRepos) excluded.add(dir);
  for (const dir of submodules) {
    if (await hasGitEntry(toAbsolute(root, dir))) excluded.add(dir);
  }
  return {
    root,
    excluded: [...excluded].sort().map((p) => toAbsolute(root, p)),
    extraFiles: [...new Set(extraFiles)].sort().map((p) => toAbsolute(root, p))
  };
}
function sameWatchSpec(a, b) {
  return a.root === b.root && sameList3(a.excluded, b.excluded) && sameList3(a.extraFiles, b.extraFiles);
}
function sameList3(a, b) {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}
var init_watch_spec = __esm({
  "src/core/watcher/watch-spec.ts"() {
    "use strict";
    init_fs();
    init_git2();
    init_paths3();
  }
});

// src/core/watcher/change-feed.ts
import { realpath as realpath2 } from "node:fs/promises";
import { basename as basename4 } from "node:path";
function createChangeFeed(options) {
  return new Feed(options);
}
var SPEC_INPUTS, Feed;
var init_change_feed = __esm({
  "src/core/watcher/change-feed.ts"() {
    "use strict";
    init_types();
    init_backend();
    init_candidates();
    init_debounce();
    init_exclusions();
    init_git2();
    init_watch_spec();
    SPEC_INPUTS = /* @__PURE__ */ new Set([".gitignore", ".git"]);
    Feed = class {
      constructor(options) {
        this.options = options;
        this.root = options.root;
        this.backend = options.backend ?? createWatcherBackend(process.platform);
        this.timings = { ...WATCHER_TIMINGS, ...options.timings };
        this.extraFiles = [...options.extraFiles ?? []];
        this.debouncer = new Debouncer((paths) => this.onDebounced(paths), this.timings);
      }
      options;
      spec = null;
      root;
      backend;
      timings;
      debouncer;
      extraFiles;
      sub = null;
      queue = Promise.resolve();
      idleTimer = null;
      closed = false;
      async start() {
        this.root = await realpath2(this.root);
        const status2 = await gitStatus(this.root);
        this.spec = await buildWatchSpec(this.root, this.extraFiles, status2);
        this.sub = await this.backend.watch(this.spec, {
          onHints: (hints) => this.onHints(hints),
          onDropped: (reason2) => this.onLost(() => this.options.onDropped?.(reason2)),
          onError: (error) => this.onLost(() => this.options.onError(error))
        });
        await this.reconcile("start");
      }
      reconcile(trigger) {
        return this.enqueue(() => this.reconcileNow(trigger));
      }
      setExtraFiles(paths) {
        this.extraFiles = [...paths];
        return this.enqueue(async () => {
          await this.rebuildSpec();
        });
      }
      async close() {
        this.closed = true;
        this.debouncer.cancel();
        if (this.idleTimer) clearTimeout(this.idleTimer);
        await this.sub?.close();
        await this.queue;
      }
      onHints(hints) {
        if (this.closed) return;
        this.debouncer.push(hints.map((h) => h.path));
        this.armIdle();
      }
      /** Backend errors are treated like dropped events: events may be missing. */
      onLost(report2) {
        if (this.closed) return;
        report2();
        void this.reconcile("dropped-events");
      }
      onDebounced(paths) {
        void this.enqueue(async () => {
          const specChanged = paths.some((p) => SPEC_INPUTS.has(basename4(p)));
          let widened = specChanged ? await this.rebuildSpec() : false;
          const { paths: candidates, ignoredDirs } = await candidatesFromHints(this.context(), paths);
          if (ignoredDirs.length > 0 && !specChanged) widened = await this.rebuildSpec();
          if (candidates.length > 0) await this.emit({ trigger: "watch", paths: candidates });
          if (widened) await this.reconcileNow("watch");
        });
      }
      async reconcileNow(trigger) {
        const status2 = await gitStatus(this.root);
        await this.rebuildSpec(status2);
        const paths = await candidatesForReconcile(this.context(), status2.paths);
        await this.emit({ trigger, paths });
      }
      /** Rebuilds the spec and updates the watch. True when some path is no longer excluded. */
      async rebuildSpec(status2) {
        const current = this.spec;
        if (!current || !this.sub) return false;
        const next = await buildWatchSpec(this.root, this.extraFiles, status2);
        if (sameWatchSpec(current, next)) return false;
        await this.sub.update(next);
        this.spec = next;
        return current.excluded.some((p) => !next.excluded.includes(p));
      }
      context() {
        const spec = this.spec ?? { root: this.root, excluded: [], extraFiles: [] };
        return {
          root: this.root,
          exclusions: new Exclusions(spec),
          extraFiles: new Set(this.extraFiles),
          trackedPaths: this.options.trackedPaths ?? (() => [])
        };
      }
      async emit(batch) {
        if (this.closed) return;
        await this.options.onBatch(batch);
      }
      /** Runs tasks one at a time. A failed task is reported and does not stop the queue. */
      enqueue(task) {
        const run = this.queue.then(async () => {
          if (this.closed) return;
          try {
            await task();
          } catch (error) {
            this.options.onError(error instanceof Error ? error : new Error(String(error)));
          } finally {
            this.armIdle();
          }
        });
        this.queue = run;
        return run;
      }
      /** Schedules the idle reconciliation; any hint or batch pushes it back. */
      armIdle() {
        if (this.idleTimer) clearTimeout(this.idleTimer);
        if (this.closed) return;
        this.idleTimer = setTimeout(() => {
          if (this.debouncer.pending) this.armIdle();
          else void this.reconcile("interval");
        }, this.timings.reconcileIntervalMs);
        this.idleTimer.unref();
      }
    };
  }
});

// src/core/watcher/index.ts
var init_watcher2 = __esm({
  "src/core/watcher/index.ts"() {
    "use strict";
    init_backend();
    init_change_feed();
    init_watch_spec();
  }
});

// src/core/daemon-loop/head.ts
async function readHead(root) {
  const [sha, status2] = await Promise.all([
    // Exit 1: unborn `HEAD`, no commit yet.
    runGit(root, ["rev-parse", "--verify", "-q", "HEAD"], { okCodes: [0, 1] }),
    runGit(root, [
      "--no-optional-locks",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignore-submodules=all"
    ])
  ]);
  const head = sha.trim();
  return { head: head === "" ? null : head, dirty: splitNul(status2).length > 0 };
}
var init_head = __esm({
  "src/core/daemon-loop/head.ts"() {
    "use strict";
    init_fs();
  }
});

// src/core/daemon-loop/index.ts
var daemon_loop_exports = {};
__export(daemon_loop_exports, {
  createDaemonLoop: () => createDaemonLoop,
  readHead: () => readHead
});
function createDaemonLoop(options) {
  const { onDropped, backend, timings, ...rest } = options;
  let feed = null;
  const scheduler = createScheduler({
    ...rest,
    head: () => readHead(options.root),
    onExtraFiles: (paths) => {
      feed?.setExtraFiles(paths).catch((error) => options.onError(toError(error)));
    }
  });
  return {
    scheduler,
    async start() {
      await scheduler.start();
      feed = createChangeFeed({
        root: options.root,
        onBatch: (batch) => scheduler.handleBatch(batch),
        onError: options.onError,
        ...onDropped === void 0 ? {} : { onDropped },
        ...backend === void 0 ? {} : { backend },
        ...timings === void 0 ? {} : { timings },
        trackedPaths: () => scheduler.trackedPaths(),
        extraFiles: scheduler.extraFiles()
      });
      await feed.start();
    },
    async close() {
      await feed?.close();
      await scheduler.close();
    }
  };
}
function toError(error) {
  return error instanceof Error ? error : new Error(String(error));
}
var init_daemon_loop = __esm({
  "src/core/daemon-loop/index.ts"() {
    "use strict";
    init_scheduler3();
    init_watcher2();
    init_head();
    init_head();
  }
});

// src/runners/vitest/graph.ts
import { existsSync as existsSync8 } from "node:fs";
import { basename as basename5, dirname as dirname12, extname as extname2, join as join20, resolve as resolve6 } from "node:path";
async function importClosure(project, entries) {
  const files = /* @__PURE__ */ new Set();
  const missing = /* @__PURE__ */ new Set();
  const visit = async (file) => {
    if (files.has(file) || missing.has(file)) return;
    if (!existsSync8(file)) {
      missing.add(file);
      return;
    }
    files.add(file);
    if (file.includes("node_modules")) return;
    await Promise.all((await importTargets(project, file)).map(visit));
  };
  await Promise.all(entries.map(visit));
  return { files, missing };
}
async function directImports(project, file) {
  const files = /* @__PURE__ */ new Set();
  const missing = /* @__PURE__ */ new Set();
  for (const target of await importTargets(project, file)) {
    (existsSync8(target) ? files : missing).add(target);
  }
  return { files, missing };
}
async function importTargets(project, file) {
  const environment = project.vite.environments.ssr;
  if (!environment) {
    throw new Error(`vitest adapter: project "${project.name}" has no ssr environment`);
  }
  let transformed;
  try {
    transformed = environment.moduleGraph.getModuleById(file)?.transformResult ?? await environment.transformRequest(file);
  } catch {
    return [];
  }
  if (!transformed) return [];
  const deps = [...transformed.deps ?? [], ...transformed.dynamicDeps ?? []];
  return deps.map((dep) => depToPath(dep, file, project.config.root)).filter((target) => target !== null);
}
function depToPath(dep, importer, root) {
  if (dep.startsWith("\0") || dep.includes(":")) return null;
  const path = dep.split("?")[0] ?? dep;
  if (path.startsWith("/@fs/")) return path.slice("/@fs".length);
  if (path.startsWith("/@")) return null;
  if (path.startsWith("/")) return join20(root, path);
  if (path.startsWith("./") || path.startsWith("../")) return resolve6(dirname12(importer), path);
  return null;
}
function resolutionCandidates(target, extensions) {
  const ext = extname2(target);
  const twins = (TYPESCRIPT_TWINS[ext] ?? []).map((twin) => target.slice(0, -ext.length) + twin);
  return [
    target,
    ...extensions.map((e) => `${target}${e}`),
    ...extensions.map((e) => join20(target, `index${e}`)),
    ...twins
  ];
}
function resolutionBases(path, extensions) {
  const ext = extname2(path);
  const bases = [path];
  if (ext === "") return bases;
  if (extensions.includes(ext)) {
    bases.push(path.slice(0, -ext.length));
    if (basename5(path) === `index${ext}`) bases.push(dirname12(path));
  }
  for (const [js, twins] of Object.entries(TYPESCRIPT_TWINS)) {
    if (twins.includes(ext)) bases.push(path.slice(0, -ext.length) + js);
  }
  return bases;
}
function isMissingTarget(closure, path) {
  if (closure.missing.has(path)) return true;
  const ext = extname2(path);
  return ext !== "" && closure.missing.has(path.slice(0, -ext.length));
}
var TYPESCRIPT_TWINS;
var init_graph = __esm({
  "src/runners/vitest/graph.ts"() {
    "use strict";
    TYPESCRIPT_TWINS = {
      ".js": [".ts", ".tsx"],
      ".jsx": [".tsx"],
      ".mjs": [".mts"],
      ".cjs": [".cts"]
    };
  }
});

// src/runners/vitest/project.ts
import { basename as basename6, dirname as dirname13, join as join21 } from "node:path";
function configFiles(vitest) {
  const files = /* @__PURE__ */ new Set();
  for (const config of [vitest.vite.config, ...vitest.projects.map((p) => p.vite.config)]) {
    if (config.configFile) files.add(config.configFile);
    for (const dep of config.configFileDependencies) files.add(dep);
  }
  return files;
}
async function projectInputs(vitest, project) {
  const [setup, globalSetup] = await Promise.all([
    importClosure(project, project.config.setupFiles),
    importClosure(project, globalSetupFiles(project))
  ]);
  return { configFiles: configFiles(vitest), setup, globalSetup };
}
function isProjectInput(inputs2, path) {
  return inputs2.configFiles.has(path) || inputs2.setup.files.has(path) || inputs2.setup.missing.has(path) || inputs2.globalSetup.files.has(path) || inputs2.globalSetup.missing.has(path);
}
async function recreateTriggers(vitest) {
  const triggers = configFiles(vitest);
  for (const project of vitest.projects) {
    const closure = await importClosure(project, globalSetupFiles(project));
    for (const file of [...closure.files, ...closure.missing]) triggers.add(file);
  }
  return triggers;
}
function globalSetupFiles(project) {
  const entries = project.config.globalSetup;
  return typeof entries === "string" ? [entries] : [...entries];
}
function snapshotPath(project, testFile) {
  const resolveSnapshotPath = project.config.snapshotOptions.resolveSnapshotPath;
  if (resolveSnapshotPath) {
    return resolveSnapshotPath(testFile, ".snap", { config: project.serializedConfig });
  }
  return join21(dirname13(testFile), "__snapshots__", `${basename6(testFile)}.snap`);
}
function resolveExtensions(project) {
  return (project.vite.environments.ssr?.config ?? project.vite.config).resolve.extensions;
}
function findProject(vitest, testFile) {
  const project = vitest.projects.find((p) => p.name === testFile.project);
  if (!project) {
    throw new Error(
      `vitest adapter: project "${testFile.project}" not found for ${testFile.path}; known: ${vitest.projects.map((p) => JSON.stringify(p.name)).join(", ")}`
    );
  }
  return project;
}
var init_project = __esm({
  "src/runners/vitest/project.ts"() {
    "use strict";
    init_graph();
  }
});

// src/runners/vitest/related.ts
async function relatedSpecifications(vitest, changed) {
  if (changed.length === 0) return [];
  vitest.config.related = [...changed];
  try {
    return await vitest.getRelevantTestSpecifications();
  } finally {
    delete vitest.config.related;
  }
}
var init_related = __esm({
  "src/runners/vitest/related.ts"() {
    "use strict";
  }
});

// src/runners/vitest/affected.ts
import { existsSync as existsSync9 } from "node:fs";
async function affectedTestFiles(vitest, specs, changed) {
  if (changed.length === 0) return { direct: [], transitive: [] };
  const known2 = new Map(specs.map((s) => [specKey(s), s]));
  const affected2 = /* @__PURE__ */ new Map();
  const imported = /* @__PURE__ */ new Set();
  const direct = /* @__PURE__ */ new Set();
  const add = (spec, through) => {
    const current = known2.get(specKey(spec));
    if (!current) return;
    affected2.set(specKey(spec), current);
    if (through === "graph") imported.add(specKey(spec));
    if (through === "snapshot") direct.add(specKey(spec));
  };
  let related;
  try {
    related = await relatedSpecifications(vitest, changed);
  } catch {
    related = await walkRelated(specs, changed);
  }
  for (const spec of related) add(spec, "graph");
  const gone = changed.filter((p) => !existsSync9(p));
  const snapshots = changed.filter((p) => p.endsWith(".snap"));
  for (const project of vitest.projects) {
    const projectSpecs = specs.filter((s) => s.project === project);
    const inputs2 = await projectInputs(vitest, project);
    if (changed.some((p) => isProjectInput(inputs2, p))) {
      for (const spec of projectSpecs) add(spec, "environment");
    }
    for (const spec of projectSpecs) {
      if (snapshots.includes(snapshotPath(project, spec.moduleId))) add(spec, "snapshot");
    }
    if (gone.length === 0) continue;
    for (const spec of projectSpecs) {
      const closure = await importClosure(project, [spec.moduleId]);
      if (gone.some((p) => isMissingTarget(closure, p))) add(spec, "graph");
    }
  }
  for (const id of imported) {
    const spec = affected2.get(id);
    if (!spec || direct.has(id)) continue;
    if (changed.includes(spec.moduleId)) {
      direct.add(id);
      continue;
    }
    const imports = await directImports(spec.project, spec.moduleId);
    if (changed.some((p) => imports.files.has(p) || isMissingTarget(imports, p))) direct.add(id);
  }
  const result = { direct: [], transitive: [] };
  for (const [id, spec] of affected2)
    (direct.has(id) ? result.direct : result.transitive).push(spec);
  return result;
}
async function walkRelated(specs, changed) {
  const hits = [];
  for (const spec of specs) {
    const closure = await importClosure(spec.project, [spec.moduleId]);
    if (changed.some((p) => closure.files.has(p) || isMissingTarget(closure, p))) hits.push(spec);
  }
  return hits;
}
var specKey;
var init_affected = __esm({
  "src/runners/vitest/affected.ts"() {
    "use strict";
    init_graph();
    init_project();
    init_related();
    specKey = (spec) => `${spec.project.name}\0${spec.moduleId}`;
  }
});

// src/runners/vitest/results.ts
function toCheckError(error, paths) {
  const frame = error.stacks?.find((f) => paths.isProjectFile(f.file));
  const diff = typeof error.diff === "string" ? error.diff : null;
  return {
    name: error.name ?? "Error",
    message: paths.relativizeText(error.message ?? ""),
    stack: error.stack ? paths.relativizeText(error.stack) : null,
    location: frame ? paths.location(frame.file, frame.line, frame.column) : null,
    diff: diff === null ? null : paths.relativizeText(diff)
  };
}
function checkNames(tests) {
  const names = /* @__PURE__ */ new Map();
  const used = /* @__PURE__ */ new Set();
  for (const test of tests) {
    let name = test.fullName;
    if (used.has(name)) {
      const line = test.location ? `line ${test.location.line}` : "line ?";
      name = `${test.fullName} (${line})`;
      for (let n = 2; used.has(name); n++) name = `${test.fullName} (${line}, ${n})`;
    }
    used.add(name);
    names.set(test.id, name);
  }
  return names;
}
function toCheckRunResult(testCase, testFile, paths, fullName) {
  const result = testCase.result();
  const outcome = OUTCOMES4[result.state];
  if (!outcome) return null;
  const location2 = testCase.location;
  return {
    check: {
      kind: "test",
      project: testFile.project,
      testPath: testFile.path,
      fullName
    },
    outcome,
    durationMs: testCase.diagnostic()?.duration ?? 0,
    location: location2 ? { path: testFile.path, line: location2.line, column: location2.column } : null,
    errors: outcome === "fail" ? (result.errors ?? []).map((e) => toCheckError(e, paths)) : []
  };
}
function compareRefs(a, b) {
  return a.project === b.project ? compare(a.path, b.path) : compare(a.project, b.project);
}
var OUTCOMES4, refKey;
var init_results2 = __esm({
  "src/runners/vitest/results.ts"() {
    "use strict";
    init_fs();
    OUTCOMES4 = {
      passed: "pass",
      failed: "fail",
      skipped: "skip"
    };
    refKey = (ref) => `${ref.project}\0${ref.path}`;
  }
});

// src/runners/vitest/reporter.ts
import { appendFileSync } from "node:fs";
function createSquealReporter(current) {
  return {
    onTestCaseResult: (testCase) => current()?.testCase(testCase),
    onTestModuleEnd: (module) => current()?.moduleEnd(module),
    onTestRunEnd: (_modules, unhandledErrors, reason2) => current()?.runEnd(unhandledErrors, reason2),
    onUserConsoleLog: (log) => current()?.console(log.type, log.content)
  };
}
function moduleDuration(module) {
  const d = module.diagnostic();
  const parts = [
    d.environmentSetupDuration,
    d.prepareDuration,
    d.collectDuration,
    d.setupDuration,
    d.duration
  ];
  return parts.every((part) => Number.isFinite(part)) ? parts.reduce((a, b) => a + b, 0) : null;
}
function errorText(error) {
  const diff = typeof error.diff === "string" ? `
${error.diff}` : "";
  return `${error.stack ?? `${error.name ?? "Error"}: ${error.message}`}${diff}`;
}
var RunCollector, label, indent;
var init_reporter = __esm({
  "src/runners/vitest/reporter.ts"() {
    "use strict";
    init_results2();
    RunCollector = class {
      constructor(requested, paths) {
        this.paths = paths;
        this.#requested = new Map(requested.map((r) => [refKey(r), r]));
      }
      paths;
      results = [];
      modules = /* @__PURE__ */ new Map();
      unhandledErrors = [];
      /** Raw output for the run log, absolute paths kept. */
      log = [];
      reason = null;
      cancelRequested = false;
      /** Set once `vitest.log` is written; later notes are appended to it. */
      logFile = null;
      #requested;
      #names = /* @__PURE__ */ new WeakMap();
      #ref(project, moduleId) {
        const path = this.paths.toRelative(moduleId);
        return path === null ? null : this.#requested.get(refKey({ project, path })) ?? null;
      }
      testCase(testCase) {
        const ref = this.#ref(testCase.project.name, testCase.module.moduleId);
        if (!ref) return;
        const result = toCheckRunResult(testCase, ref, this.paths, this.#name(testCase));
        if (!result) return;
        this.results.push({ ref, result });
        this.log.push(
          `${result.outcome.toUpperCase()} ${label(ref)} > ${result.check.fullName} (${Math.round(result.durationMs)} ms)`
        );
        for (const error of testCase.result().errors ?? []) this.log.push(indent(errorText(error)));
      }
      /** The check name of a test; modules are fully collected before their tests report. */
      #name(testCase) {
        let names = this.#names.get(testCase.module);
        if (!names) {
          names = checkNames(testCase.module.children.allTests());
          this.#names.set(testCase.module, names);
        }
        return names.get(testCase.id) ?? testCase.fullName;
      }
      moduleEnd(module) {
        const ref = this.#ref(module.project.name, module.moduleId);
        if (!ref) return;
        const errors = module.errors();
        this.modules.set(refKey(ref), {
          ref,
          state: module.state(),
          errors,
          afterCancel: this.cancelRequested,
          durationMs: moduleDuration(module)
        });
        this.log.push(`MODULE ${module.state()} ${label(ref)}`);
        for (const error of errors) this.log.push(indent(`file-level error: ${errorText(error)}`));
      }
      runEnd(unhandledErrors, reason2) {
        this.unhandledErrors.push(...unhandledErrors);
        this.reason = reason2;
        this.log.push(`RUN END ${reason2}, ${unhandledErrors.length} unhandled error(s)`);
        for (const error of unhandledErrors) this.log.push(indent(`unhandled: ${errorText(error)}`));
      }
      /**
       * An adapter event for the run log, such as an error from cancelling the
       * run or closing an instance. The styleguide: "Never swallow an error
       * silently" (review N3).
       */
      note(text) {
        const line = `squeal: ${text}`;
        if (this.logFile === null) {
          this.log.push(line);
          return;
        }
        try {
          appendFileSync(this.logFile, `${line}
`);
        } catch (error) {
          process.emitWarning(`${line} (run log ${this.logFile} not writable: ${String(error)})`);
        }
      }
      console(type, content) {
        this.log.push(`[${type}] ${content.replace(/\n$/, "")}`);
      }
    };
    label = (ref) => ref.project ? `[${ref.project}] ${ref.path}` : ref.path;
    indent = (text) => text.replace(/^/gm, "    ");
  }
});

// src/runners/vitest/broken.ts
import { sep as sep4 } from "node:path";
function instanceTempDirs(vitest) {
  const root = vitest._tmpDir;
  const dirs = vitest.projects.map((p) => p.tmpDir);
  if (typeof root === "string") dirs.push(root);
  return [...new Set(dirs)];
}
function runnerFailure(collector, files) {
  const errors = [
    ...[...collector.modules.values()].flatMap((m) => m.errors),
    ...collector.unhandledErrors
  ];
  const error = errors.find((e) => isRunnerFailure(e, files));
  return error === void 0 ? null : errorText(error).split("\n")[0] ?? "";
}
function isRunnerFailure(error, files) {
  const text = `${error.message ?? ""}
${error.stack ?? ""}`;
  if (isMissingFile(error) && mentionedPaths(text).some((p) => underAny(p, files.tempDirs))) {
    return true;
  }
  const top = topFrame(error.stack ?? "");
  if (top === null || !isModuleRunner(top)) return false;
  return !mentionedPaths(text).some(
    (p) => files.paths.isProjectFile(p) && !underAny(p, files.tempDirs)
  );
}
function isMissingFile(error) {
  return error.code === "ENOENT" || /^ENOENT\b/.test(error.message ?? "");
}
function isModuleRunner(file) {
  return file.split(sep4).join("/").endsWith("/vite/dist/node/module-runner.js");
}
function mentionedPaths(text) {
  const found = text.matchAll(/(?:file:\/\/)?(\/[^\s'"`()[\]]+)/g);
  return [...found].map((m) => (m[1] ?? "").replace(/(?::\d+)+$/, ""));
}
function topFrame(stack) {
  const line = stack.split("\n").find((l) => /^\s*at\s/.test(l));
  return line === void 0 ? null : mentionedPaths(line)[0] ?? null;
}
function underAny(path, dirs) {
  return dirs.some((dir) => path === dir || path.startsWith(`${dir}${sep4}`));
}
var init_broken = __esm({
  "src/runners/vitest/broken.ts"() {
    "use strict";
    init_reporter();
  }
});

// src/runners/vitest/environment.ts
function projectEnvironment(project, inputs2, context) {
  const { paths } = context;
  const files = /* @__PURE__ */ new Set();
  for (const file of [...inputs2.configFiles, ...inputs2.setup.files, ...inputs2.globalSetup.files]) {
    const rel = paths.toRelative(file);
    if (rel !== null && paths.isProjectFile(file)) files.add(rel);
  }
  return {
    project: project.name,
    runnerName: "vitest",
    runnerVersion: context.runnerVersion,
    adapterVersion: context.adapterVersion,
    resolvedConfig: canonicalConfig(project, paths),
    files: [...files].sort(compare)
  };
}
function canonicalConfig(project, paths) {
  const { sequence, ...config } = project.serializedConfig;
  const { seed: _seed, ...stableSequence } = sequence;
  return JSON.stringify(
    canonicalize(
      { ...config, sequence: stableSequence, globalSetup: globalSetupFiles(project) },
      paths
    )
  );
}
function canonicalize(value, paths) {
  if (typeof value === "string") return paths.relativizeText(value);
  if (value instanceof RegExp) return value.toString();
  if (Array.isArray(value)) return value.map((v) => canonicalize(v, paths));
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value).filter(([, v]) => v !== void 0 && typeof v !== "function").sort(([a], [b]) => compare(a, b)).map(([k, v]) => [k, canonicalize(v, paths)]);
    return Object.fromEntries(entries);
  }
  return value;
}
var init_environment2 = __esm({
  "src/runners/vitest/environment.ts"() {
    "use strict";
    init_fs();
    init_project();
  }
});

// src/runners/vitest/load.ts
import { createRequire as createRequire2 } from "node:module";
import { join as join22 } from "node:path";
import { pathToFileURL as pathToFileURL2 } from "node:url";
async function loadVitest(root) {
  let resolved;
  try {
    resolved = createRequire2(join22(root, "package.json")).resolve("vitest/node");
  } catch (error) {
    const reason2 = error instanceof Error ? error.message.split("\n")[0] : String(error);
    throw new Error(
      `vitest/node does not resolve from ${root} (${reason2}); Squeal runs only the project's own Vitest`
    );
  }
  return await import(pathToFileURL2(resolved).href);
}
var init_load = __esm({
  "src/runners/vitest/load.ts"() {
    "use strict";
  }
});

// src/runners/vitest/run.ts
import { mkdirSync as mkdirSync7, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join23 } from "node:path";
async function execute(vitest, specs, timeoutMs, collector) {
  const run = vitest.runTestSpecifications([...specs]).then(
    () => ({ end: "completed", failure: null, hung: false }),
    (error) => ({
      end: "crashed",
      failure: describeError(error),
      hung: false
    })
  );
  if (timeoutMs === null) return run;
  const first = await settleWithin(run, timeoutMs);
  if (first) return first;
  collector.cancelRequested = true;
  const failure2 = `run exceeded timeoutMs (${timeoutMs} ms)`;
  cancel(vitest, collector);
  if (await settleWithin(run, GRACE_BEFORE_FORCE_MS))
    return { end: "timed-out", failure: failure2, hung: false };
  cancel(vitest, collector);
  if (await settleWithin(run, GRACE_AFTER_FORCE_MS))
    return { end: "timed-out", failure: failure2, hung: false };
  return { end: "timed-out", failure: `${failure2}; workers did not stop`, hung: true };
}
function cancel(vitest, collector) {
  vitest.cancelCurrentRun(CANCEL_REASON).catch((error) => collector.note(`cancelCurrentRun failed: ${describeError(error)}`));
}
function abandon2(vitest, collector) {
  vitest.close().catch(
    (error) => collector.note(`close() of an abandoned instance failed: ${describeError(error)}`)
  );
}
async function settleWithin(promise, ms) {
  let timer;
  const timeout = new Promise((resolve7) => {
    timer = setTimeout(() => resolve7(null), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
function buildReport(collector, execution, durationMs) {
  const unattributed = collector.unhandledErrors.filter((e) => owner(e, collector) === null);
  const end = unattributed.length > 0 ? "crashed" : execution.end;
  const failure2 = [
    ...execution.failure === null ? [] : [execution.failure],
    ...unattributed.map((e) => `unhandled error outside any test file: ${errorText(e)}`)
  ].join("\n");
  const completed = end === "crashed" ? [] : [...collector.modules.values()].filter((m) => !m.afterCancel && m.state !== "pending" && m.state !== "queued").map((m) => m.ref).sort(compareRefs);
  const completedKeys = new Set(completed.map(refKey));
  const errors = /* @__PURE__ */ new Map();
  const addErrors = (ref, list) => {
    if (list.length === 0) return;
    const existing = errors.get(refKey(ref))?.errors ?? [];
    errors.set(refKey(ref), { testFile: ref, errors: [...existing, ...list] });
  };
  for (const module of collector.modules.values()) {
    if (completedKeys.has(refKey(module.ref))) {
      addErrors(
        module.ref,
        module.errors.map((e) => toCheckError(e, collector.paths))
      );
    }
  }
  for (const error of collector.unhandledErrors) {
    const rel = owner(error, collector);
    for (const ref of completed.filter((r) => r.path === rel)) {
      addErrors(ref, [toCheckError(error, collector.paths)]);
    }
  }
  return {
    end,
    durationMs,
    completedFiles: completed,
    results: collector.results.filter((r) => completedKeys.has(refKey(r.ref))).sort((a, b) => compareRefs(a.ref, b.ref)).map((r) => r.result),
    fileErrors: [...errors.values()].sort((a, b) => compareRefs(a.testFile, b.testFile)),
    failure: failure2 === "" ? null : collector.paths.relativizeText(failure2),
    fileDurations: [...collector.modules.values()].filter((m) => completedKeys.has(refKey(m.ref)) && m.durationMs !== null).sort((a, b) => compareRefs(a.ref, b.ref)).map((m) => ({ testFile: m.ref, durationMs: m.durationMs ?? 0 }))
  };
}
function owner(error, collector) {
  const path = typeof error.VITEST_TEST_PATH === "string" ? error.VITEST_TEST_PATH : null;
  return path === null ? null : collector.paths.toRelative(path);
}
function writeRunLog(options, collector, report2) {
  mkdirSync7(options.logDir, { recursive: true });
  const header = [
    `squeal vitest run ${options.runId}`,
    `end: ${report2.end}${report2.failure ? ` (${report2.failure})` : ""}, ${report2.durationMs} ms`,
    ""
  ];
  const logFile = join23(options.logDir, "vitest.log");
  writeFileSync2(logFile, `${[...header, ...collector.log].join("\n")}
`);
  collector.logFile = logFile;
  writeFileSync2(
    join23(options.logDir, "report.json"),
    `${JSON.stringify({ runId: options.runId, report: report2 }, null, 2)}
`
  );
}
function describeError(error) {
  return error instanceof Error ? error.stack ?? error.message : String(error);
}
var GRACE_BEFORE_FORCE_MS, GRACE_AFTER_FORCE_MS, CANCEL_REASON;
var init_run = __esm({
  "src/runners/vitest/run.ts"() {
    "use strict";
    init_reporter();
    init_results2();
    GRACE_BEFORE_FORCE_MS = 1e3;
    GRACE_AFTER_FORCE_MS = 5e3;
    CANCEL_REASON = "squeal-timeout";
  }
});

// src/runners/vitest/dynamic.ts
import { readFileSync as readFileSync6 } from "node:fs";
function expandsFromDisk(file, transform) {
  let found = scanned.get(transform);
  if (found === void 0) {
    const source = readSource(file);
    found = source === null || DYNAMIC_SPECIFIER.test(source);
    scanned.set(transform, found);
  }
  return found;
}
function readSource(file) {
  try {
    return readFileSync6(file, "utf8");
  } catch {
    return null;
  }
}
var DYNAMIC_SPECIFIER, scanned;
var init_dynamic = __esm({
  "src/runners/vitest/dynamic.ts"() {
    "use strict";
    DYNAMIC_SPECIFIER = /import\.meta\.glob|\bimport\s*\(\s*`[^`]*\$\{/;
    scanned = /* @__PURE__ */ new WeakMap();
  }
});

// src/runners/vitest/stale.ts
import { existsSync as existsSync10, readFileSync as readFileSync7 } from "node:fs";
import { isBuiltin } from "node:module";
import { basename as basename7, dirname as dirname14, join as join24 } from "node:path";
function staleTransforms(vitest, added, deleted) {
  const stale = /* @__PURE__ */ new Set();
  const gone = new Set(deleted);
  for (const project of vitest.projects) {
    for (const environment of Object.values(project.vite.environments)) {
      const extensions = environment.config.resolve.extensions;
      const targets = new Set(deleted);
      const directories = [...added, ...deleted].filter(isPackageJson).map((p) => `${dirname14(p)}/`);
      for (const path of added) {
        const bases = resolutionBases(path, extensions);
        for (const base of bases) {
          for (const candidate of resolutionCandidates(base, extensions)) targets.add(candidate);
          if (base !== dirname14(path)) directories.push(`${base}/`);
        }
        for (const dir of entryDirectories(path, bases, project.config.root)) {
          directories.push(`${dir}/`);
        }
      }
      const reresolves = (dep, file) => {
        const path = depToPath(dep, file, project.config.root);
        if (path === null) return added.length > 0 && isUnresolvedBare(dep);
        return targets.has(path) || directories.some((dir) => path.startsWith(dir));
      };
      for (const [file, modules] of environment.moduleGraph.fileToModulesMap) {
        if (stale.has(file) || gone.has(file)) continue;
        for (const module of modules) {
          if (!knowsSoftInvalidation(vitest, module)) return null;
          const result = cachedTransform(module);
          if (!result) continue;
          const deps = [...result.deps ?? [], ...result.dynamicDeps ?? []];
          if (deps.some((dep) => reresolves(dep, file)) || added.length > 0 && expandsFromDisk(file, result)) {
            stale.add(file);
            break;
          }
        }
      }
    }
  }
  return stale;
}
function entryDirectories(path, bases, root) {
  const found = [];
  for (let dir = dirname14(path); dir.startsWith(`${root}/`); dir = dirname14(dir)) {
    const manifest = join24(dir, "package.json");
    if (!existsSync10(manifest)) continue;
    const named = packageEntries(manifest).map((entry2) => join24(dir, entry2).replace(/\/+$/, ""));
    if (named.some((entry2) => bases.includes(entry2))) found.push(dir);
  }
  return found;
}
function packageEntries(manifest) {
  let fields;
  try {
    fields = JSON.parse(readFileSync7(manifest, "utf8"));
  } catch {
    return [];
  }
  if (!isRecord(fields)) return [];
  const dot = isRecord(fields.exports) ? fields.exports["."] : fields.exports;
  return [fields.main, fields.module, dot].filter(
    (entry2) => typeof entry2 === "string"
  );
}
function isUnresolvedBare(dep) {
  return !dep.startsWith("/") && !dep.startsWith(".") && !dep.startsWith("\0") && !dep.includes(":") && !isBuiltin(dep);
}
function knowsSoftInvalidation(vitest, module) {
  let known2 = tracksSoftInvalidation.get(vitest);
  if (known2 === void 0) {
    known2 = "invalidationState" in module;
    tracksSoftInvalidation.set(vitest, known2);
  }
  return known2;
}
function cachedTransform(module) {
  if (module.transformResult) return module.transformResult;
  const state = module.invalidationState;
  return typeof state === "object" && state !== null ? state : null;
}
function cachedFiles(vitest) {
  const files = /* @__PURE__ */ new Set();
  for (const project of vitest.projects) {
    for (const environment of Object.values(project.vite.environments)) {
      for (const file of environment.moduleGraph.fileToModulesMap.keys()) files.add(file);
    }
  }
  return files;
}
var tracksSoftInvalidation, isPackageJson, isRecord, FALLBACK_NOTE;
var init_stale = __esm({
  "src/runners/vitest/stale.ts"() {
    "use strict";
    init_dynamic();
    init_graph();
    tracksSoftInvalidation = /* @__PURE__ */ new WeakMap();
    isPackageJson = (path) => basename7(path) === "package.json";
    isRecord = (value) => typeof value === "object" && value !== null;
    FALLBACK_NOTE = "vitest adapter: this Vite keeps no `invalidationState` on its module nodes, so every add or delete invalidates every cached transform; `affected` after one costs a cold walk (spec 001 D4)";
  }
});

// src/runners/vitest/adapter.ts
async function testSpecifications(vitest) {
  return (await vitest.globTestSpecifications()).filter((s) => s.pool !== "typescript");
}
var VITEST_ADAPTER_VERSION, VitestAdapter;
var init_adapter = __esm({
  "src/runners/vitest/adapter.ts"() {
    "use strict";
    init_keys();
    init_affected();
    init_broken();
    init_environment2();
    init_graph();
    init_load();
    init_project();
    init_reporter();
    init_results2();
    init_run();
    init_stale();
    VITEST_ADAPTER_VERSION = "2";
    VitestAdapter = class {
      /**
       * `vitest` is the project's own `vitest/node` (`loadVitest`). Only types
       * come from Squeal's Vitest, so loading this module loads no Vitest.
       * `note` records a fact the adapter worked around as a status note (D7).
       */
      constructor(paths, vitest, note = () => {
      }) {
        this.paths = paths;
        this.#node = vitest;
        this.#note = note;
      }
      paths;
      name = "vitest";
      adapterVersion = VITEST_ADAPTER_VERSION;
      #vitest = null;
      /** Where the current instance copies transformed modules (`instanceTempDirs`). */
      #tempDirs = [];
      /** Installed lockfiles the current instance started with. */
      #lockfiles = /* @__PURE__ */ new Set();
      /** The next start imports `vitest/node` again: the installed dependencies changed. */
      #reload = false;
      #node;
      #collector = null;
      /** Bumped per instance, so hooks from an abandoned instance never reach a later run. */
      #generation = 0;
      #queue = Promise.resolve();
      #closed = false;
      /** Instances that fell back to full invalidation and have said so once (reviews/wave-7.md S2). */
      #fellBack = /* @__PURE__ */ new WeakSet();
      #note;
      /** Spec 001 D4: `createVitest('test', { root, watch: false, ... })`, then `standalone()`. */
      async #start() {
        if (this.#reload) {
          this.#node = await loadVitest(this.paths.root);
          this.#reload = false;
        }
        const generation = ++this.#generation;
        const current = () => generation === this.#generation ? this.#collector : null;
        const vitest = await this.#node.createVitest("test", {
          root: this.paths.root,
          watch: false,
          reporters: [createSquealReporter(current)],
          update: "none",
          includeTaskLocation: true
        });
        try {
          await vitest.standalone();
          this.#tempDirs = instanceTempDirs(vitest);
          this.#lockfiles = await this.#installedLockfiles(vitest);
        } catch (error) {
          await vitest.close();
          throw error;
        }
        return vitest;
      }
      /** The installed lockfile of each project, as the environment hash finds it (D3). */
      async #installedLockfiles(vitest) {
        const found = /* @__PURE__ */ new Set();
        for (const project of vitest.projects) {
          const lockfile = await findInstalledLockfile(project.config.root, this.paths.root);
          if (lockfile !== null) found.add(lockfile.path);
        }
        return found;
      }
      async open() {
        this.#vitest = await this.#start();
      }
      #serial(fn) {
        const next = this.#queue.then(async () => {
          if (this.#closed) throw new Error("vitest adapter: closed");
          this.#vitest ??= await this.#start();
          return fn(this.#vitest);
        });
        this.#queue = next.catch(() => {
        });
        return next;
      }
      async #recreate(old) {
        this.#vitest = null;
        await old.close();
        this.#vitest = await this.#start();
        return this.#vitest;
      }
      invalidate(paths) {
        return this.#serial(async (vitest) => {
          const abs = paths.map((p) => ({ ...p, abs: this.paths.toAbsolute(p.path) }));
          const triggers = await recreateTriggers(vitest);
          const lockfiles = /* @__PURE__ */ new Set([...this.#lockfiles, ...await this.#installedLockfiles(vitest)]);
          if (abs.some((p) => lockfiles.has(p.abs))) this.#reload = true;
          if (abs.some((p) => triggers.has(p.abs) || lockfiles.has(p.abs))) {
            const before = vitest.projects.map((p) => p.name);
            const fresh = await this.#recreate(vitest);
            const names = /* @__PURE__ */ new Set([...before, ...fresh.projects.map((p) => p.name)]);
            return { recreatedProjects: [...names].sort() };
          }
          for (const p of abs) vitest.invalidateFile(p.abs);
          const structural = abs.filter((p) => p.kind !== "change");
          if (structural.length > 0) {
            const added = structural.filter((p) => p.kind === "add").map((p) => p.abs);
            const deleted = structural.filter((p) => p.kind === "delete").map((p) => p.abs);
            const stale = staleTransforms(vitest, added, deleted);
            for (const file of stale ?? cachedFiles(vitest)) vitest.invalidateFile(file);
            if (stale === null && !this.#fellBack.has(vitest)) {
              this.#fellBack.add(vitest);
              this.#note(FALLBACK_NOTE);
            }
            const testGlob = structural.some(
              (p) => vitest.projects.some((project) => project.matchesTestGlob(p.abs, () => ""))
            );
            if (testGlob) vitest.clearSpecificationsCache();
          }
          return { recreatedProjects: [] };
        });
      }
      affected(changedPaths) {
        return this.#serial(async (vitest) => {
          const specs = await testSpecifications(vitest);
          const changed = changedPaths.map((p) => this.paths.toAbsolute(p));
          const { direct, transitive } = await affectedTestFiles(vitest, specs, changed);
          return {
            direct: direct.map((s) => this.#ref(s)).sort(compareRefs),
            transitive: transitive.map((s) => this.#ref(s)).sort(compareRefs)
          };
        });
      }
      closure(testFile) {
        return this.#serial(async (vitest) => {
          const project = findProject(vitest, testFile);
          const abs = this.paths.toAbsolute(testFile.path);
          const graph = await importClosure(project, [abs]);
          const files = new Set(graph.files);
          files.add(snapshotPath(project, abs));
          const extensions = resolveExtensions(project);
          for (const target of graph.missing) {
            for (const candidate of resolutionCandidates(target, extensions)) files.add(candidate);
          }
          const paths = [...files].filter((f) => this.paths.isProjectFile(f)).map((f) => this.paths.toRelative(f)).filter((p) => p !== null).sort();
          return { testFile, paths };
        });
      }
      enumerate(testFile) {
        return this.#serial(async (vitest) => {
          const project = findProject(vitest, testFile);
          const spec = project.createSpecification(this.paths.toAbsolute(testFile.path));
          const [module] = await vitest.parseSpecifications([spec]);
          if (!module) return [];
          const names = checkNames(module.children.allTests());
          return [...module.children.allTests()].map((test) => ({
            check: {
              kind: "test",
              project: testFile.project,
              testPath: testFile.path,
              fullName: names.get(test.id) ?? test.fullName
            },
            // Research Q2: `test.each` parses to one entry with a `-dynamic` id.
            templated: test.options.each === true || test.id.endsWith("-dynamic"),
            location: test.location ? { path: testFile.path, line: test.location.line, column: test.location.column } : null
          }));
        });
      }
      testFiles() {
        return this.#serial(
          async (vitest) => (await testSpecifications(vitest)).map((s) => this.#ref(s)).sort(compareRefs)
        );
      }
      environment() {
        return this.#serial(async (vitest) => {
          const context = {
            paths: this.paths,
            runnerVersion: this.#node.version,
            adapterVersion: this.adapterVersion
          };
          const envs = [];
          for (const project of vitest.projects) {
            envs.push(projectEnvironment(project, await projectInputs(vitest, project), context));
          }
          return envs.sort((a, b) => a.project < b.project ? -1 : a.project > b.project ? 1 : 0);
        });
      }
      run(testFiles, options) {
        return this.#serial(async (vitest) => {
          const specs = testFiles.map(
            (ref) => findProject(vitest, ref).createSpecification(this.paths.toAbsolute(ref.path))
          );
          const collector = new RunCollector(testFiles, this.paths);
          if (specs.length === 0) {
            const empty = buildReport(collector, { end: "completed", failure: null, hung: false }, 0);
            writeRunLog(options, collector, empty);
            return empty;
          }
          const exitCode = process.exitCode;
          const started = performance.now();
          this.#collector = collector;
          try {
            let execution = await execute(vitest, specs, options.timeoutMs, collector);
            if (execution.hung) {
              this.#vitest = null;
              abandon2(vitest, collector);
            }
            const broken = runnerFailure(collector, { paths: this.paths, tempDirs: this.#tempDirs });
            if (broken !== null && this.#vitest === vitest) {
              execution = {
                end: "crashed",
                failure: `the Vitest instance failed to load modules and is recreated: ${broken}`,
                hung: false
              };
              this.#vitest = null;
              await vitest.close().catch(
                (error) => collector.note(`close() of a broken instance failed: ${String(error)}`)
              );
            }
            const report2 = buildReport(collector, execution, Math.round(performance.now() - started));
            if (broken !== null && report2.failure !== null) this.#note(report2.failure);
            writeRunLog(options, collector, report2);
            return report2;
          } finally {
            this.#collector = null;
            process.exitCode = exitCode;
          }
        });
      }
      close() {
        const closing = this.#queue.then(async () => {
          if (this.#closed) return;
          this.#closed = true;
          const vitest = this.#vitest;
          this.#vitest = null;
          await vitest?.close();
        });
        this.#queue = closing.catch(() => {
        });
        return closing;
      }
      #ref(spec) {
        const path = this.paths.toRelative(spec.moduleId);
        if (path === null) {
          throw new Error(`vitest adapter: test file outside the worktree: ${spec.moduleId}`);
        }
        return { project: spec.project.name, path };
      }
    };
  }
});

// src/runners/vitest/paths.ts
import { sep as sep5 } from "node:path";
import { stripVTControlCharacters as stripVTControlCharacters2 } from "node:util";
var WorktreePaths;
var init_paths4 = __esm({
  "src/runners/vitest/paths.ts"() {
    "use strict";
    init_fs();
    WorktreePaths = class {
      constructor(root) {
        this.root = root;
      }
      root;
      toAbsolute(path) {
        return toAbsolute(this.root, path);
      }
      /** `null` when the path is the root itself or outside it. */
      toRelative(path) {
        return toRelative(this.root, path);
      }
      isProjectFile(path) {
        return this.toRelative(path) !== null && !path.split(sep5).includes("node_modules");
      }
      /** Spec 001 D4: "Stack paths are relativized before storage." Also strips ANSI colours. */
      relativizeText(text) {
        return stripVTControlCharacters2(text).replaceAll(`file://${this.root}/`, "").replaceAll(`${this.root}/`, "").replaceAll(this.root, ".");
      }
      location(file, line, column) {
        const path = this.toRelative(file);
        return path === null ? null : { path, line, column };
      }
    };
  }
});

// src/runners/vitest/index.ts
var vitest_exports = {};
__export(vitest_exports, {
  VITEST_ADAPTER_VERSION: () => VITEST_ADAPTER_VERSION,
  createVitestAdapter: () => createVitestAdapter
});
import { realpathSync as realpathSync4 } from "node:fs";
async function createVitestAdapter(options) {
  const root = realpathSync4(options.root);
  const adapter = new VitestAdapter(new WorktreePaths(root), await loadVitest(root), options.note);
  await adapter.open();
  return adapter;
}
var init_vitest = __esm({
  "src/runners/vitest/index.ts"() {
    "use strict";
    init_adapter();
    init_load();
    init_paths4();
    init_adapter();
  }
});

// src/core/daemon/runner.ts
var runner_exports = {};
__export(runner_exports, {
  createRecoveringRunner: () => createRecoveringRunner
});
function createRecoveringRunner(options) {
  let inner = null;
  let error = null;
  let reported = null;
  let retry = false;
  let creating = null;
  let closed = false;
  const around = options.around ?? ((call) => call());
  const attempt = () => {
    retry = false;
    creating ??= (async () => {
      try {
        const created = await options.create();
        if (closed) {
          await created.close();
          throw new Error(`${options.name} adapter: closed`);
        }
        inner = created;
        if (error !== null) options.onRecovered?.();
        error = null;
        reported = null;
        return created;
      } catch (cause) {
        error = new Error(`Vitest could not start: ${messageOf(cause)}`, { cause });
        if (error.message !== reported && !closed) {
          reported = error.message;
          options.onFailure(error.message);
        }
        throw error;
      } finally {
        creating = null;
      }
    })();
    return creating;
  };
  const adapter = async () => {
    if (closed) throw new Error(`${options.name} adapter: closed`);
    if (inner !== null) return inner;
    if (creating !== null || retry || error === null) return attempt();
    throw error;
  };
  return {
    name: options.name,
    adapterVersion: options.adapterVersion,
    open: () => around(async () => {
      try {
        await adapter();
        return true;
      } catch {
        return false;
      }
    }),
    retry() {
      retry = true;
    },
    invalidate: (paths) => around(async () => {
      if (inner !== null || closed) return (await adapter()).invalidate(paths);
      retry = true;
      const fresh = await adapter();
      const projects = new Set((await fresh.environment()).map((e) => e.project));
      return { recreatedProjects: [...projects].sort() };
    }),
    affected: (changedPaths) => around(async () => (await adapter()).affected(changedPaths)),
    closure: (testFile) => around(async () => (await adapter()).closure(testFile)),
    enumerate: (testFile) => around(async () => (await adapter()).enumerate(testFile)),
    testFiles: () => around(async () => (await adapter()).testFiles()),
    environment: () => around(async () => (await adapter()).environment()),
    run: (testFiles, runOptions) => around(async () => (await adapter()).run(testFiles, runOptions)),
    close: () => around(async () => {
      if (closed) return;
      closed = true;
      await creating?.catch(() => {
      });
      await inner?.close();
    })
  };
}
function messageOf(error) {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(ANSI_COLOUR, "").trim();
}
var ANSI_COLOUR;
var init_runner = __esm({
  "src/core/daemon/runner.ts"() {
    "use strict";
    ANSI_COLOUR = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
  }
});

// src/core/daemon/version.ts
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
var UNKNOWN_VERSION = "0.0.0-unknown";
var PACKAGE_NAME = "squeal";
function squealVersion() {
  if (true) return "0.1.1";
  return manifestVersion(new URL(import.meta.url)) ?? UNKNOWN_VERSION;
}
function manifestVersion(module) {
  let dir = dirname(fileURLToPath(module));
  for (; ; ) {
    const version = readVersion(join(dir, "package.json"));
    if (version !== null) return version;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
function readVersion(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return null;
    const { name, version } = parsed;
    return name === PACKAGE_NAME && typeof version === "string" ? version : null;
  } catch {
    return null;
  }
}

// src/core/status/index.ts
init_state2();

// src/core/status/format-status.ts
init_state2();
function formatStatus(result, now) {
  if (!result.available) return formatUnavailable(result);
  const lines = [
    `Revision: ${result.revision}`,
    `Known failures: ${result.knownFailures.length}`,
    ...result.knownFailures.flatMap((f) => [
      `  FAIL  ${formatCheck(f.check)}`,
      ...f.summary === "" ? [] : [`        ${f.summary}`],
      `        ${[
        ...f.location === null ? [] : [`at ${f.location.path}:${f.location.line}:${f.location.column}`],
        `observed at revision ${f.observedAt}`,
        f.validity
      ].join(", ")}`
    ]),
    `Affected checks: ${affected(result)}`,
    `Full-suite checkpoint: ${fullSuiteText(result)}`,
    "",
    worktreeLine(result),
    daemonLine(result, now),
    `Inherited: ${result.inherited.count} current ${plural(result.inherited.count, "result")}`,
    ...result.inherited.sources.map(
      (s) => `  ${s.count} from ${s.worktreeRoot ?? s.worktreeId} at ${shortCommit(s.commit)}`
    ),
    ...result.breakdown.testFilesWithoutChecks === 0 ? [] : [
      `Test files without checks: ${result.testFilesWithoutChecks.pending} pending, ${result.testFilesWithoutChecks.unknown} unknown`
    ],
    `Closure method: ${result.closureMethod}`,
    `Store schema: ${result.storeSchemaVersion}`,
    ...notes(result)
  ];
  return `${lines.join("\n")}
`;
}
function notes(s) {
  const daemon = s.daemonNotes.map((n) => {
    const at = new Date(n.at).toISOString();
    return n.revision === null ? `${at}: ${n.text}` : `${at}, revision ${n.revision}: ${n.text}`;
  });
  const all = [...s.notes, ...daemon];
  return all.length === 0 ? [] : ["Notes:", ...all.map((note) => `  ${note}`)];
}
function formatUnavailable(result) {
  return `${result.message.charAt(0).toUpperCase()}${result.message.slice(1)}
`;
}
function affected(s) {
  if (s.testFilesListed === false) {
    return "none counted; the daemon has not listed this worktree's test files yet";
  }
  const { currentByOutcome, pendingByPhase } = s.breakdown;
  const parts = [
    `${currentByOutcome.pass} passed`,
    `${pendingByPhase.running} running`,
    `${pendingByPhase.queued} queued`
  ];
  const optional = [
    [currentByOutcome.skip, "skipped"],
    [s.counts.stale, "stale"],
    [s.counts.unknown + currentByOutcome.unknown, "unknown"]
  ];
  for (const [count, label2] of optional) if (count > 0) parts.push(`${count} ${label2}`);
  const runnerPart = s.runnerPartPending === true ? `; ${runnerPartText(s.revision)} is pending, so test files it adds are not counted yet` : "";
  return `${parts.join(", ")}${runnerPart}`;
}
function worktreeLine(s) {
  const dirty = s.dirty !== null ? `${s.dirty ? "dirty" : "clean"} at revision ${s.dirtyObservedAt ?? s.revision}` : s.daemon.state === "alive" ? "dirty state not known: no revision recorded yet" : "dirty state not known: no daemon is validating";
  return `Worktree: ${s.worktreeRoot} (HEAD ${shortCommit(s.head)}, ${dirty})`;
}
function daemonLine(s, now) {
  if (s.daemon.state === "alive") {
    return `Daemon: running, last heartbeat ${age(now - s.daemon.lastHeartbeatAt)} ago`;
  }
  if (s.daemon.since === null) return "Daemon: no daemon running";
  return `Daemon: no daemon running since ${new Date(s.daemon.since).toISOString()}`;
}
function shortCommit(commit) {
  return commit === null ? "no commit" : commit.slice(0, 7);
}
function plural(count, word) {
  return count === 1 ? word : `${word}s`;
}
function age(ms) {
  const seconds = Math.max(0, Math.round(ms / 1e3));
  if (seconds < 120) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  return `${Math.round(minutes / 60)} h`;
}

// src/core/status/format-why.ts
init_state2();
var INDENT = "        ";
function formatWhy(why2) {
  if (!why2.available) return formatUnavailable(why2);
  if (!why2.found) {
    if (why2.candidates.length === 0) return `No check matches "${why2.query}" in this worktree.
`;
    return `${[
      `"${why2.query}" matches ${why2.candidates.length} checks in this worktree:`,
      ...why2.candidates.map((c) => `  ${formatCheck(c)}`)
    ].join("\n")}
`;
  }
  const lines = [
    `Check: ${formatCheck(why2.check)}`,
    `Worktree: ${why2.worktreeRoot}`,
    `Revision: ${why2.revision ?? "none recorded"}`,
    "",
    ...knownState(why2, why2.knownState),
    "",
    ...history(why2.history),
    "",
    ...results(why2),
    "",
    `Last run log: ${why2.results[0]?.logDir ?? "none"}`
  ];
  return `${lines.join("\n")}
`;
}
function knownState(why2, s) {
  if (s === null) return ["Known state: none in this worktree"];
  const head = [
    upper(s.outcome),
    s.pendingPhase === null ? s.validity : `${s.validity} (${s.pendingPhase})`,
    ...s.observedAt === null ? [] : [`observed at revision ${s.observedAt}`],
    ...s.commit === null ? [] : [`commit ${shortCommit(s.commit)}`]
  ];
  const lines = [`Known state: ${head.join(", ")}`];
  if (s.origin?.kind === "inherited") {
    const source = why2.worktreeRoots[s.origin.worktreeId] ?? `removed worktree ${s.origin.worktreeId}`;
    lines.push(`  Origin: inherited from ${source} at ${shortCommit(s.origin.commit)}`);
  }
  if (s.summary !== null) lines.push(`  Summary: ${s.summary}`);
  if (s.location !== null) {
    lines.push(`  Location: ${s.location.path}:${s.location.line}:${s.location.column}`);
  }
  if (s.fingerprint !== null) lines.push(`  Fingerprint: ${s.fingerprint}`);
  return lines;
}
function history(transitions) {
  if (transitions.length === 0) return ["History: no transitions in this worktree"];
  return [
    `History (${transitions.length} ${plural(transitions.length, "transition")}, oldest first):`,
    ...transitions.map(
      (t) => `  revision ${t.revision}  ${new Date(t.at).toISOString()}  ${transitionText(t)}`
    )
  ];
}
function transitionText(t) {
  if (t.kind === "first-seen-fail") return "first seen FAIL";
  const change = `${t.from === null ? "NONE" : upper(t.from)} -> ${upper(t.to)}`;
  return t.kind === "fail-changed" ? `${change}, failure changed` : change;
}
function results(why2) {
  if (why2.results.length === 0) return ["Results: none stored"];
  return [
    `Results (${why2.results.length}, newest first):`,
    ...why2.results.flatMap((entry2) => resultLines(why2, entry2))
  ];
}
function resultLines(why2, { result, worktreeRoot: worktreeRoot2, logDir }) {
  const p = result.provenance;
  const where2 = p.worktreeId === why2.worktreeId ? `${worktreeRoot2 ?? why2.worktreeRoot} (this worktree)` : worktreeRoot2 ?? `removed worktree ${p.worktreeId}`;
  const lines = [
    `  ${upper(result.outcome).padEnd(4)}  ${new Date(p.recordedAt).toISOString()}  ${where2}, revision ${p.revision}, commit ${shortCommit(p.commit)}, ${p.dirty ? "dirty" : "clean"}`,
    `${INDENT}run ${p.runId}, ${Math.round(result.durationMs)} ms, key ${result.key.slice(0, 12)}`,
    `${INDENT}log: ${logDir ?? "run record pruned"}`
  ];
  if (result.summary !== null) lines.push(`${INDENT}${result.summary}`);
  for (const error of result.errors) {
    const text = [error.stack ?? `${error.name}: ${error.message}`, error.diff].filter((part) => part !== null).join("\n");
    for (const line of text.split("\n")) lines.push(`${INDENT}${line}`);
  }
  return lines;
}
function upper(outcome) {
  return outcome.toUpperCase();
}

// src/core/status/open.ts
init_fs();
init_store2();
init_types();
var STATUS_BUSY_TIMEOUT_MS = 1e3;
function unavailable(reason2, detail) {
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: false,
    reason: reason2,
    message: `status unavailable, ${detail}`
  };
}
function withStatusStore(cwd, options, fn) {
  const root = findWorktreeRoot(cwd);
  const commonDir = root === null ? null : resolveCommonDir(root);
  if (root === null || commonDir === null) {
    return unavailable("no-store", `${cwd} is not inside a git worktree`);
  }
  const busyTimeoutMs = options.busyTimeoutMs ?? STATUS_BUSY_TIMEOUT_MS;
  let store;
  try {
    const opened = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(opened)) {
      switch (opened.reason) {
        case "missing":
          return unavailable("no-store", `no Squeal store at ${storePaths(commonDir).database}`);
        case "newer-schema":
          return unavailable(
            "store-newer",
            `store version newer than this Squeal (store ${opened.found}, supported ${opened.supported})`
          );
        case "corrupt":
          return unavailable(
            "store-unreadable",
            `store at ${storePaths(commonDir).database} is corrupt`
          );
      }
    }
    store = opened;
    return fn({ store, root });
  } catch (error) {
    if (isBusy(error)) {
      return unavailable("timeout", `store busy for more than ${busyTimeoutMs} ms`);
    }
    return unavailable("store-unreadable", `store unreadable: ${String(error)}`);
  } finally {
    store?.close();
  }
}
function isBusy(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/status/snapshot.ts
init_keys();
init_notes();
init_state2();
init_store2();
init_types();

// src/core/status/git-head.ts
init_fs();
import { readFileSync as readFileSync3 } from "node:fs";
import { join as join8 } from "node:path";
var SHA = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;
var MAX_REF_DEPTH = 5;
function readGitHead(root) {
  const gitDir = gitDirOf(root);
  const commonDir = resolveCommonDir(root);
  if (gitDir === null || commonDir === null) return null;
  let value = read2(join8(gitDir, "HEAD"));
  for (let depth = 0; depth < MAX_REF_DEPTH && value !== null; depth++) {
    if (SHA.test(value)) return value;
    const ref = /^ref:\s*(\S+)$/.exec(value)?.[1];
    if (ref === void 0) return null;
    value = read2(join8(gitDir, ref)) ?? read2(join8(commonDir, ref)) ?? packed(commonDir, ref);
  }
  return null;
}
function packed(commonDir, ref) {
  for (const line of (read2(join8(commonDir, "packed-refs")) ?? "").split("\n")) {
    const [sha, name] = line.split(" ");
    if (name === ref && sha !== void 0 && SHA.test(sha)) return sha;
  }
  return null;
}
function read2(path) {
  try {
    return readFileSync3(path, "utf8").trim();
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

// src/core/status/snapshot.ts
var HEARTBEAT_GRACE_INTERVALS = 2;
function readStatus(cwd, options = {}) {
  const now = options.now ?? Date.now;
  return withStatusStore(cwd, options, ({ store, root }) => buildSnapshot(store, root, now()));
}
function buildSnapshot(store, root, now) {
  return snapshot(store, worktreeIdFor(root), root, now);
}
function snapshot(store, worktreeId, root, now) {
  const worktree = store.worktrees.get(worktreeId);
  const revision = store.revisions.latest(worktreeId);
  const states = store.knownStates.list(worktreeId);
  const keys = store.testFileKeys.list(worktreeId);
  const header = readHeader(store, worktreeId, states, keys);
  const notes2 = [];
  if (worktree === null) {
    notes2.push("this worktree is not registered in the store; no daemon has run here");
  }
  if (revision === null) notes2.push("no revision recorded for this worktree yet");
  const recovered = recoveryNote(store.meta.get(META_STORE_RECOVERED));
  if (recovered !== null) notes2.push(recovered);
  const daemon = liveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
  const observed = daemon.state === "alive" ? revision : null;
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    worktreeId,
    worktreeRoot: worktree?.root ?? root,
    ...header,
    head: revision === null ? readGitHead(root) : revision.head,
    dirty: observed?.dirty ?? null,
    dirtyObservedAt: observed?.number ?? null,
    daemon,
    knownFailures: states.flatMap((s) => toKnownFailure(s, header.revision) ?? []),
    inherited: inheritedSources(store, states),
    breakdown: breakdown(states, keys),
    closureMethod: CLOSURE_METHOD,
    storeSchemaVersion: store.schemaVersion,
    notes: notes2,
    daemonNotes: readDaemonNotes(store, worktreeId)
  };
}
function liveness(daemon, now, lastHeartbeatAt) {
  if (daemon === null) return { state: "down", since: lastHeartbeatAt };
  const age2 = now - daemon.heartbeatAt;
  if (age2 <= daemon.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: daemon.heartbeatAt };
  }
  return { state: "down", since: daemon.heartbeatAt };
}
function inheritedSources(store, states) {
  const groups = /* @__PURE__ */ new Map();
  let count = 0;
  for (const s of states) {
    if (s.validity !== "current" || s.origin?.kind !== "inherited") continue;
    count++;
    const id = JSON.stringify([s.origin.worktreeId, s.origin.commit]);
    const group = groups.get(id) ?? {
      worktreeId: s.origin.worktreeId,
      commit: s.origin.commit,
      count: 0
    };
    group.count++;
    groups.set(id, group);
  }
  const sources = [...groups.values()].map((g) => ({ ...g, worktreeRoot: store.worktrees.get(g.worktreeId)?.root ?? null })).sort(
    (a, b) => b.count - a.count || a.worktreeId.localeCompare(b.worktreeId) || String(a.commit).localeCompare(String(b.commit))
  ).map(({ worktreeId, worktreeRoot: worktreeRoot2, commit, count: count2 }) => ({
    worktreeId,
    worktreeRoot: worktreeRoot2,
    commit,
    count: count2
  }));
  return { count, sources };
}
function breakdown(states, keys) {
  const filePhase = new Map(keys.map((k) => [testFileId(k.testFile), k.pending]));
  const currentByOutcome = { pass: 0, fail: 0, skip: 0, unknown: 0 };
  const pendingByPhase = { queued: 0, running: 0 };
  const filesWithChecks = /* @__PURE__ */ new Set();
  for (const s of states) {
    const file = testFileKeyOf(s.check);
    filesWithChecks.add(file);
    if (s.validity === "current") currentByOutcome[s.outcome]++;
    if (s.validity === "pending")
      pendingByPhase[s.pendingPhase ?? filePhase.get(file) ?? "queued"]++;
  }
  const testFilesWithoutChecks = keys.filter(
    (k) => !filesWithChecks.has(testFileId(k.testFile))
  ).length;
  return { currentByOutcome, pendingByPhase, testFiles: keys.length, testFilesWithoutChecks };
}
function recoveryNote(raw) {
  if (raw === null) return null;
  try {
    const { at, movedTo } = JSON.parse(raw);
    const when = typeof at === "number" ? ` at ${new Date(at).toISOString()}` : "";
    const where2 = typeof movedTo === "string" ? ` (corrupt file moved to ${movedTo})` : "";
    return `store was recovered from corruption${when}; the baseline was lost${where2}`;
  } catch {
    return `store was recovered from corruption; the baseline was lost (${raw})`;
  }
}

// src/core/status/why.ts
init_state2();
init_store2();
init_types();
var WHY_RESULT_LIMIT = 20;
var WHY_CANDIDATE_LIMIT = 20;
function readWhy(cwd, query, options = {}) {
  return withStatusStore(cwd, options, ({ store, root }) => {
    const worktreeId = worktreeIdFor(root);
    const exact = parseCheck(query);
    if (exact !== null && known(store, worktreeId, exact)) return report(store, root, exact);
    const match = resolve3(store, worktreeId, query.trim());
    return "found" in match ? match : report(store, root, match);
  });
}
function known(store, worktreeId, check) {
  return store.knownStates.get(worktreeId, check) !== null || store.transitions.history(worktreeId, check).length > 0 || store.results.listForCheck(check, 1).length > 0;
}
function resolve3(store, worktreeId, query) {
  const named = store.knownStates.list(worktreeId).map((s) => ({
    check: s.check,
    name: formatCheck(s.check)
  }));
  const stem = query.endsWith("...") ? query.slice(0, -3) : null;
  let matches = named.filter(
    (n) => n.name.includes(query) || stem !== null && n.name.startsWith(stem)
  );
  if (matches.length > 1) {
    const ending = matches.filter(
      (n) => n.name.endsWith(` > ${query}`) || n.name.endsWith(`/${query}`)
    );
    if (ending.length === 1) matches = ending;
  }
  const [only] = matches;
  if (matches.length === 1 && only !== void 0) return only.check;
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: false,
    query,
    candidates: matches.slice(0, WHY_CANDIDATE_LIMIT).map((n) => n.check)
  };
}
function report(store, root, check) {
  const worktreeId = worktreeIdFor(root);
  const worktreeRoots = Object.fromEntries(store.worktrees.list().map((w) => [w.id, w.root]));
  return {
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    available: true,
    found: true,
    worktreeId,
    worktreeRoot: worktreeRoots[worktreeId] ?? root,
    revision: store.revisions.latest(worktreeId)?.number ?? null,
    check,
    worktreeRoots,
    knownState: store.knownStates.get(worktreeId, check),
    history: store.transitions.history(worktreeId, check),
    results: store.results.listForCheck(check, WHY_RESULT_LIMIT).map((result) => ({
      result,
      worktreeRoot: worktreeRoots[result.provenance.worktreeId] ?? null,
      logDir: store.runs.get(result.provenance.runId)?.logDir ?? null
    }))
  };
}

// src/core/daemon/daemon.ts
init_types();

// src/core/daemon/desk.ts
import { existsSync as existsSync4 } from "node:fs";
import { fileURLToPath as fileURLToPath2 } from "node:url";
import { Worker } from "node:worker_threads";

// src/core/daemon/handlers.ts
init_types();
import { randomUUID } from "node:crypto";

// src/core/daemon/protocol.ts
init_types();
var MAX_LINE_BYTES = 64 * 1024;
function parseRequest(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return "request is not valid JSON";
  }
  if (typeof value !== "object" || value === null) return "request is not a JSON object";
  const request = value;
  switch (request.type) {
    case "ping":
    case "nudge":
    case "stop":
      return { type: request.type };
    case "run-all":
      if (request.force !== void 0 && typeof request.force !== "boolean") {
        return '"force" must be true or false';
      }
      return { type: "run-all", force: request.force === true };
    case "run-all-status":
      if (typeof request.requestId !== "string") return '"requestId" must be a string';
      return { type: "run-all-status", requestId: request.requestId };
    default:
      return `unknown request type ${JSON.stringify(request.type)}`;
  }
}
function errorResponse(error) {
  return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: false, error };
}

// src/core/daemon/handlers.ts
var MAX_REQUESTS = 32;
function createHandlers(context) {
  const requests = /* @__PURE__ */ new Map();
  const runAll = (requestId, state) => ({
    schemaVersion: PAYLOAD_SCHEMA_VERSION,
    ok: true,
    type: "run-all",
    requestId,
    checkpoint: state.checkpoint,
    error: state.error
  });
  return (request) => {
    switch (request.type) {
      case "ping":
        return {
          schemaVersion: PAYLOAD_SCHEMA_VERSION,
          ok: true,
          type: "ping",
          pid: process.pid,
          worktreeId: context.worktreeId,
          root: context.root,
          squealVersion: context.squealVersion,
          phase: context.phase(),
          startedAt: context.startedAt
        };
      case "nudge":
        context.onActivity();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "nudge" };
      case "run-all": {
        if (context.phase() === "stopping") return errorResponse("daemon is stopping");
        context.onActivity();
        const requestId = randomUUID();
        const state = { checkpoint: null, error: null };
        requests.set(requestId, state);
        for (const old of requests.keys()) {
          if (requests.size <= MAX_REQUESTS) break;
          requests.delete(old);
        }
        context.requestFullSuite(request.force === true).then(
          (checkpoint) => {
            state.checkpoint = checkpoint;
          },
          (error) => {
            state.error = error instanceof Error ? error.message : String(error);
          }
        );
        return runAll(requestId, state);
      }
      case "run-all-status": {
        const state = requests.get(request.requestId);
        if (state === void 0) return errorResponse(`unknown request id ${request.requestId}`);
        return runAll(request.requestId, state);
      }
      case "stop":
        context.onStop();
        return { schemaVersion: PAYLOAD_SCHEMA_VERSION, ok: true, type: "stop" };
    }
  };
}

// src/core/daemon/server.ts
import { chmodSync, mkdirSync as mkdirSync2, rmSync as rmSync3 } from "node:fs";
import { createServer } from "node:net";
import { dirname as dirname4 } from "node:path";
var IDLE_CONNECTION_MS = 2e3;
async function createDaemonServer(socketPath, handle) {
  mkdirSync2(dirname4(socketPath), { recursive: true, mode: 448 });
  rmSync3(socketPath, { force: true });
  const connections2 = /* @__PURE__ */ new Set();
  const server = createServer((socket) => {
    connections2.add(socket);
    socket.on("close", () => connections2.delete(socket));
    serve(socket, handle);
  });
  await new Promise((resolve7, reject) => {
    server.once("error", reject);
    server.listen(socketPath, () => {
      server.off("error", reject);
      resolve7();
    });
  });
  chmodSync(socketPath, 384);
  let closing = null;
  return {
    socketPath,
    close() {
      closing ??= new Promise((resolve7) => {
        server.close(() => resolve7());
        for (const socket of connections2) socket.destroy();
      });
      return closing;
    }
  };
}
function serve(socket, handle) {
  let buffer = "";
  socket.setEncoding("utf8");
  socket.setTimeout(IDLE_CONNECTION_MS, () => socket.destroy());
  socket.on("error", () => socket.destroy());
  socket.on("data", (chunk) => {
    buffer += chunk;
    const end = buffer.indexOf("\n");
    if (end < 0) {
      if (buffer.length > MAX_LINE_BYTES) answer(socket, errorResponse("request too long"));
      return;
    }
    const request = parseRequest(buffer.slice(0, end));
    buffer = "";
    if (typeof request === "string") {
      answer(socket, errorResponse(request));
      return;
    }
    let response;
    try {
      response = handle(request);
    } catch (error) {
      response = errorResponse(`daemon error: ${String(error)}`);
    }
    answer(socket, response);
  });
}
function answer(socket, response) {
  socket.removeAllListeners("data");
  socket.end(`${JSON.stringify(response)}
`);
}

// src/core/daemon/desk.ts
function prepareFrontDesk() {
  const script = frontDeskScript(new URL(import.meta.url));
  if (script === null) {
    return { open: (identity, events) => inThread(identity, events), discard: () => {
    } };
  }
  const worker = new Worker(script);
  const early = [];
  const onError = (error) => early.push(error);
  const onExit = (code) => early.push(new Error(`socket worker exited with code ${code}`));
  worker.on("error", onError);
  worker.on("exit", onExit);
  return {
    open: (identity, events) => {
      worker.off("error", onError);
      worker.off("exit", onExit);
      if (early[0] !== void 0) return Promise.reject(early[0]);
      return inWorker(worker, identity, events);
    },
    discard: () => void worker.terminate()
  };
}
function frontDeskScript(module) {
  for (const name of ["./front-desk.js", "./front-desk.mjs"]) {
    const script = fileURLToPath2(new URL(name, module));
    if (existsSync4(script)) return script;
  }
  return null;
}
async function inWorker(worker, identity, events) {
  const post = (message2) => worker.postMessage(message2);
  let listening = false;
  let closing = false;
  let closed = null;
  const listen = new Promise((resolve7, reject) => {
    worker.on("message", (message2) => {
      switch (message2.type) {
        case "listening":
          listening = true;
          resolve7();
          return;
        case "failed":
          reject(new Error(message2.error));
          return;
        case "activity":
          events.onActivity();
          return;
        case "run-all":
          events.requestFullSuite(message2.force).then(
            (checkpoint) => post({ type: "run-all-result", id: message2.id, checkpoint, error: null }),
            (error) => post({
              type: "run-all-result",
              id: message2.id,
              checkpoint: null,
              error: String(error)
            })
          );
          return;
        case "stop":
          events.onStop();
          return;
        case "closed":
          closed?.();
          return;
      }
    });
    const died = (error) => {
      if (!listening) reject(error);
      else if (!closing) events.onFailure(error);
      closed?.();
    };
    worker.on("error", died);
    worker.on("exit", (code) => died(new Error(`socket worker exited with code ${code}`)));
    post({ type: "bind", identity });
  });
  try {
    await listen;
  } catch (error) {
    closing = true;
    await worker.terminate();
    throw error;
  }
  return {
    setPhase: (phase) => post({ type: "phase", phase }),
    async close() {
      if (closing) return;
      closing = true;
      await new Promise((resolve7) => {
        closed = resolve7;
        post({ type: "close" });
      });
      await worker.terminate();
    }
  };
}
async function inThread(identity, events) {
  let phase = "starting";
  const server = await createDaemonServer(
    identity.socketPath,
    createHandlers({
      worktreeId: identity.worktreeId,
      root: identity.root,
      squealVersion: identity.squealVersion,
      startedAt: identity.startedAt,
      phase: () => phase,
      requestFullSuite: events.requestFullSuite,
      onActivity: events.onActivity,
      onStop: events.onStop
    })
  );
  return {
    setPhase: (next) => {
      phase = next;
    },
    close: () => server.close()
  };
}

// src/core/daemon/lifecycle.ts
import { existsSync as existsSync6 } from "node:fs";

// src/core/delivery/index.ts
init_state2();

// src/core/delivery/delivery.ts
init_state2();
init_types();

// src/core/waiter-lock/waiter-lock.ts
import { createHash as createHash5 } from "node:crypto";
import { existsSync as existsSync5, mkdirSync as mkdirSync3, rmSync as rmSync4 } from "node:fs";
import { join as join9 } from "node:path";
import { DatabaseSync as DatabaseSync2 } from "node:sqlite";
function waiterLockPath(locksDir, consumer) {
  const id = createHash5("sha256").update(JSON.stringify([consumer.worktreeId, consumer.sessionId, consumer.agentId])).digest("hex").slice(0, 16);
  return join9(locksDir, `waiter-${id}.sqlite`);
}
function removeWaiterLock(locksDir, consumer) {
  const path = waiterLockPath(locksDir, consumer);
  if (!existsSync5(path)) return;
  const db = lock(path);
  if (db === null) return;
  try {
    rmSync4(path, { force: true });
  } finally {
    db.close();
  }
}
function waiterLockState(locksDir, consumer) {
  const path = waiterLockPath(locksDir, consumer);
  if (!existsSync5(path)) return "absent";
  const db = lock(path);
  if (db === null) return "held";
  db.close();
  return "free";
}
function lock(path) {
  const db = new DatabaseSync2(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
    return db;
  } catch {
    db.close();
    return null;
  }
}

// src/core/delivery/delta.ts
init_state2();
function beforeFailing(history2, state) {
  const last = history2.at(-1);
  if (state.outcome !== "fail" || last?.to !== "fail" || last.toFingerprint !== state.fingerprint) {
    return null;
  }
  const entered = history2.findLast((t) => t.kind !== "fail-changed");
  return entered?.from == null ? null : { outcome: entered.from, fingerprint: entered.fromFingerprint };
}
var RANK = {
  "pass-to-fail": 0,
  "first-seen-fail": 0,
  "fail-changed": 1,
  "to-unknown": 3,
  "fail-to-pass": 4,
  "fail-retired": 5
};
var rank = (e) => isBaselineEntry(e) ? 2 : RANK[e.kind];
function isBaselineEntry(e) {
  return e.kind !== "fail-retired" && e.baseline === true;
}
function toView2(state, toldAt) {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt };
}
function planDelta(input) {
  const told = new Map(input.view.map((v) => [checkIdentity(v.check), v]));
  const entries = [];
  const writes = [];
  for (const state of input.states) {
    const id = checkIdentity(state.check);
    const before = told.get(id) ?? null;
    told.delete(id);
    const prior = before === null && state.outcome === "fail" && input.history !== void 0 ? beforeFailing(input.history(state.check), state) : null;
    const kind = transitionKind(before ?? prior, state);
    if (before === null || kind !== null) writes.push(toView2(state, input.toldAt));
    if (kind === null) continue;
    const baseline = kind === "first-seen-fail" && input.isBaselineFinding(state.check, state.fingerprint);
    const originRoot = state.origin?.kind === "inherited" ? input.rootOf(state.origin.worktreeId) : null;
    entries.push({
      check: state.check,
      kind,
      from: (before ?? prior)?.outcome ?? null,
      to: state.outcome,
      validity: state.validity,
      observedAt: state.observedAt ?? input.revision,
      origin: state.origin ?? { kind: "own" },
      ...originRoot === null ? {} : { originRoot },
      summary: state.summary,
      location: state.location,
      ...baseline ? { baseline } : {}
    });
  }
  for (const view of told.values()) {
    if (view.outcome !== "fail") continue;
    entries.push({
      check: view.check,
      kind: "fail-retired",
      from: "fail",
      to: null,
      fingerprint: view.fingerprint,
      observedAt: input.revision
    });
  }
  const sorted = entries.map((entry2, i) => ({ entry: entry2, i })).sort((a, b) => rank(a.entry) - rank(b.entry) || a.i - b.i).map(({ entry: entry2 }) => entry2);
  return { entries: sorted, writes, removals: [...told.values()].map((v) => v.check) };
}

// src/core/delivery/liveness.ts
init_state2();
function daemonLiveness(record, now, lastHeartbeatAt = null) {
  if (record === null) return { state: "down", since: lastHeartbeatAt };
  if (now - record.heartbeatAt <= record.heartbeatIntervalMs * HEARTBEAT_GRACE_INTERVALS) {
    return { state: "alive", lastHeartbeatAt: record.heartbeatAt };
  }
  return { state: "down", since: record.heartbeatAt };
}
function worktreeLiveness(worktree, now) {
  return daemonLiveness(worktree?.daemon ?? null, now, worktree?.lastHeartbeatAt ?? null);
}
function livenessMetaKey(worktreeId) {
  return `liveness-told:${worktreeId}`;
}
var slot = (consumer) => `${consumer.sessionId}
${consumer.agentId}`;
function readAll(store, worktreeId) {
  const raw = store.meta.get(livenessMetaKey(worktreeId));
  if (raw === null) return {};
  try {
    const value = JSON.parse(raw);
    return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}
function tellLiveness(store, consumer, state) {
  const registered = new Set(
    store.consumers.list(consumer.worktreeId).map((r) => slot(r.consumer))
  );
  const next = {};
  for (const [key, value] of Object.entries(readAll(store, consumer.worktreeId))) {
    if (registered.has(key)) next[key] = value;
  }
  if (state === null) delete next[slot(consumer)];
  else next[slot(consumer)] = state;
  store.meta.set(livenessMetaKey(consumer.worktreeId), JSON.stringify(next));
}

// src/core/delivery/delivery.ts
function expireConsumers(store, now = Date.now(), options = {}) {
  const expired = [...store.transaction(() => store.consumers.expire(now - CONSUMER_EXPIRY_MS))];
  const { locksDir } = options;
  if (locksDir === void 0) return expired;
  for (const consumer of expired) removeWaiterLock(locksDir, consumer);
  const cutoff = now - WAITERLESS_EXPIRY_MS;
  for (const { consumer } of store.consumers.idleSince(cutoff)) {
    if (waiterLockState(locksDir, consumer) !== "free") continue;
    const gone = store.transaction(() => {
      const record = store.consumers.get(consumer);
      if (record === null || !idle(record, cutoff)) return false;
      store.consumers.unregister(consumer);
      tellLiveness(store, consumer, null);
      return true;
    });
    if (!gone) continue;
    removeWaiterLock(locksDir, consumer);
    expired.push(consumer);
  }
  return expired;
}
function idle(record, cutoff) {
  return record.lastSeenAt < cutoff && (record.lastDeliveredAt ?? 0) < cutoff;
}

// src/core/delivery/format.ts
init_state2();

// src/core/daemon/lifecycle.ts
init_store2();
function startTimers(context) {
  const { store, worktreeId, now, timings } = context;
  const idleMs = context.policy.daemon.idleExitMinutes * 6e4;
  const checkMs = timings.checkMs ?? Math.min(5e3, Math.max(50, idleMs / 10));
  const expireMs = timings.expireMs ?? 6e4;
  const pruneMs = timings.pruneMs ?? 60 * 6e4;
  const { locksDir } = storePaths(context.commonDir);
  let lastExpire = Number.NEGATIVE_INFINITY;
  const attempt = (what, fn) => {
    try {
      fn();
    } catch (error) {
      context.log(`${what} failed: ${String(error)}`);
    }
  };
  const check = () => {
    if (!existsSync6(context.root)) {
      context.shutdown("root-removed", `daemon stopped: worktree root ${context.root} was deleted`);
      return;
    }
    if (context.linkedDir !== null && !existsSync6(context.linkedDir)) {
      context.shutdown(
        "worktree-removed",
        `daemon stopped: worktree entry ${context.linkedDir} was removed`
      );
      return;
    }
    const at = now();
    if (at - lastExpire >= expireMs) {
      lastExpire = at;
      attempt("consumer expiry", () => expireConsumers(store, at, { locksDir }));
    }
    attempt("idle check", () => {
      if (store.consumers.list(worktreeId).length > 0) context.active(at);
      else if (at - context.lastActive() >= idleMs) {
        context.shutdown(
          "idle",
          `daemon stopped: idle for ${duration(idleMs)} with no registered consumers`
        );
      }
    });
  };
  const prune2 = () => attempt("prune", () => {
    store.prune({
      now: now(),
      retentionDays: context.policy.store.retentionDays,
      maxSizeMb: context.policy.store.maxSizeMb
    });
  });
  const timers = [
    setInterval(
      () => attempt("heartbeat", () => store.worktrees.heartbeat(worktreeId, now())),
      context.heartbeatMs
    ),
    setInterval(check, checkMs),
    setInterval(prune2, pruneMs)
  ];
  const first = setTimeout(prune2, timings.firstPruneMs ?? 6e4);
  for (const timer of [...timers, first]) timer.unref();
  return () => {
    for (const timer of timers) clearInterval(timer);
    clearTimeout(first);
  };
}
function duration(ms) {
  return ms < 6e4 ? `${Number((ms / 1e3).toFixed(1))} s` : `${Number((ms / 6e4).toFixed(1))} min`;
}

// src/core/daemon/notes.ts
init_notes();
init_store2();
init_types();
import { DatabaseSync as DatabaseSync3 } from "node:sqlite";
function writeNote(store, worktreeId, note, log) {
  try {
    appendNote(store, worktreeId, note);
  } catch (error) {
    log(`could not persist a note (${note.text}): ${String(error)}`);
  }
}
function noteInNewerStore(commonDir, worktreeId, note) {
  let db;
  try {
    db = new DatabaseSync3(storePaths(commonDir).database);
    db.exec("PRAGMA busy_timeout = 2000");
    const columns = db.prepare("SELECT name FROM pragma_table_info('meta')").all();
    const names = new Set(columns.map((c) => String(c.name)));
    if (!names.has("key") || !names.has("value")) return false;
    const key = notesMetaKey(worktreeId);
    db.exec("BEGIN IMMEDIATE");
    const row = db.prepare("SELECT value FROM meta WHERE key = ?").get(key);
    const notes2 = withNote(row?.value, note);
    db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)").run(
      key,
      JSON.stringify(notes2)
    );
    db.exec("COMMIT");
    return true;
  } catch {
    return false;
  } finally {
    db?.close();
  }
}

// src/core/daemon/open.ts
init_fs();
init_store2();
import { existsSync as existsSync7, realpathSync as realpathSync3 } from "node:fs";
import { join as join12 } from "node:path";

// src/core/daemon/lock.ts
import { mkdirSync as mkdirSync4 } from "node:fs";
import { dirname as dirname5 } from "node:path";
import { DatabaseSync as DatabaseSync4 } from "node:sqlite";
function acquireDaemonLock(path) {
  mkdirSync4(dirname5(path), { recursive: true });
  const db = new DatabaseSync4(path);
  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec("PRAGMA locking_mode = EXCLUSIVE");
    db.exec("BEGIN EXCLUSIVE");
  } catch (error) {
    db.close();
    if (isBusy2(error)) return null;
    throw error;
  }
  let held = true;
  return {
    release() {
      if (!held) return;
      held = false;
      try {
        db.exec("ROLLBACK");
      } finally {
        db.close();
      }
    }
  };
}
function isBusy2(error) {
  const code = error?.errcode;
  return typeof code === "number" && [5, 6].includes(code & 255);
}

// src/core/daemon/scratch.ts
init_paths2();
import { createHash as createHash6, randomBytes } from "node:crypto";
import {
  linkSync,
  lstatSync as lstatSync3,
  mkdirSync as mkdirSync6,
  mkdtempSync,
  readdirSync,
  readFileSync as readFileSync4,
  renameSync as renameSync2,
  rmSync as rmSync5,
  unlinkSync,
  writeFileSync
} from "node:fs";
import { rm } from "node:fs/promises";
import { basename, dirname as dirname7, join as join11 } from "node:path";

// src/core/daemon/paths.ts
init_fs();
import { chmodSync as chmodSync2, lstatSync as lstatSync2, mkdirSync as mkdirSync5 } from "node:fs";
import { tmpdir as tmpdir2 } from "node:os";
import { dirname as dirname6, isAbsolute as isAbsolute3, join as join10 } from "node:path";
function runtimeDir(env = process.env) {
  return xdgRuntimeDir(env) ?? join10(tempDir(env), userDirName());
}
var MAX_SOCKET_PATH_BYTES = 103;
function socketPathFor(worktreeId, env = process.env) {
  const name = `squeal-${worktreeId}.sock`;
  const path = join10(runtimeDir(env), name);
  return Buffer.byteLength(path) <= MAX_SOCKET_PATH_BYTES ? path : join10(userTmpDir(), name);
}
function prepareSocketDir(socketPath, env = process.env, uid = currentUid()) {
  const dir = dirname6(socketPath);
  if (dir === xdgRuntimeDir(env)) {
    mkdirSync5(dir, { recursive: true, mode: 448 });
    return;
  }
  preparePrivateDir(dir, uid);
}
function preparePrivateDir(dir, uid = currentUid(), role = "socket directory") {
  mkdirSync5(dirname6(dir), { recursive: true });
  try {
    mkdirSync5(dir, { mode: 448 });
    chmodSync2(dir, 448);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  checkPrivateDir(dir, uid, role);
}
function checkPrivateDir(dir, uid, role = "socket directory") {
  const refusal = role === "socket directory" ? "refusing to bind in it" : "refusing to use it";
  const stat5 = lstatSync2(dir);
  if (!stat5.isDirectory()) {
    throw new Error(`${role} ${dir} is not a directory; ${refusal}`);
  }
  if (stat5.uid !== uid) {
    throw new Error(`${role} ${dir} is owned by uid ${stat5.uid}, not ${uid}; ${refusal}`);
  }
  if ((stat5.mode & 63) !== 0) {
    const mode = (stat5.mode & 511).toString(8).padStart(3, "0");
    throw new Error(`${role} ${dir} has mode ${mode}, not 700; ${refusal}`);
  }
}
function userTmpDir(uid = currentUid()) {
  return join10("/tmp", `squeal-${uid}`);
}
function xdgRuntimeDir(env) {
  const xdg = env.XDG_RUNTIME_DIR;
  return xdg !== void 0 && xdg !== "" && isAbsolute3(xdg) ? xdg : null;
}
function tempDir(env) {
  if (process.platform === "win32") return tmpdir2();
  const given = env.TMPDIR || env.TMP || env.TEMP || "/tmp";
  const dir = isAbsolute3(given) ? given : "/tmp";
  return dir.length > 1 && dir.endsWith("/") ? dir.slice(0, -1) : dir;
}
function userDirName() {
  return `squeal-${currentUid()}`;
}
function currentUid() {
  return process.getuid?.() ?? 0;
}

// src/core/daemon/scratch.ts
function daemonScratch(commonDir, root, uid = currentUid()) {
  const userDir = userTmpDir(uid);
  const key = createHash6("sha256").update(`${repositoryId(commonDir)}\0${root}`).digest("hex").slice(0, 16);
  return { workDir: storePaths(commonDir).dir, userDir, tempDir: join11(userDir, "tmp", key) };
}
function repositoryId(commonDir) {
  const dir = storePaths(commonDir).dir;
  const file = join11(dir, "repository-id");
  mkdirSync6(dir, { recursive: true });
  const draft = `${file}.${process.pid}-${randomBytes(4).toString("hex")}`;
  writeFileSync(draft, `${randomBytes(16).toString("hex")}
`);
  try {
    linkSync(draft, file);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  } finally {
    unlinkSync(draft);
  }
  return readFileSync4(file, "utf8").trim();
}
function prepareScratch(scratch, uid = currentUid()) {
  const leftovers = ownFallbacks(scratch, uid);
  try {
    preparePrivateDir(scratch.userDir, uid, "temp directory");
  } catch (error) {
    const tempDir2 = mkdtempSync(fallbackPrefix(scratch));
    const text = error instanceof Error ? error.message : String(error);
    return {
      scratch: { ...scratch, tempDir: tempDir2 },
      refusal: `${text}; using ${tempDir2} instead`,
      leftovers: removeInBackground(leftovers)
    };
  }
  try {
    renameSync2(scratch.tempDir, `${scratch.tempDir}.old-${randomBytes(4).toString("hex")}`);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  mkdirSync6(scratch.tempDir, { recursive: true });
  return {
    scratch,
    refusal: null,
    leftovers: removeInBackground([...leftovers, ...movedAside(scratch)])
  };
}
function removeScratch(scratch) {
  for (const dir of [scratch.tempDir, ...movedAside(scratch)]) {
    rmSync5(dir, { recursive: true, force: true });
  }
}
function movedAside(scratch) {
  const parent = dirname7(scratch.tempDir);
  const prefix = `${basename(scratch.tempDir)}.old-`;
  return safeList(parent).filter((name) => name.startsWith(prefix)).map((name) => join11(parent, name));
}
function fallbackPrefix(scratch) {
  return `${scratch.userDir}-${basename(scratch.tempDir)}-`;
}
function ownFallbacks(scratch, uid) {
  const prefix = fallbackPrefix(scratch);
  const parent = dirname7(prefix);
  return safeList(parent).map((name) => join11(parent, name)).filter((path) => path.startsWith(prefix)).filter((path) => {
    const stat5 = lstatSync3(path, { throwIfNoEntry: false });
    return stat5?.isDirectory() === true && stat5.uid === uid;
  });
}
function removeInBackground(dirs) {
  return Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true }))).then(
    () => {
    },
    () => {
    }
  );
}
function safeList(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
function adoptScratch(scratch) {
  process.chdir(scratch.workDir);
  process.env.TMPDIR = scratch.tempDir;
  process.env.TMP = scratch.tempDir;
  process.env.TEMP = scratch.tempDir;
}
function inRootWhileRunning(root, scratch) {
  let inFlight = 0;
  return async (call) => {
    if (inFlight++ === 0) chdirQuietly(root);
    try {
      return await call();
    } finally {
      if (--inFlight === 0) chdirQuietly(scratch.workDir);
    }
  };
}
function chdirQuietly(dir) {
  try {
    process.chdir(dir);
  } catch {
  }
}

// src/core/daemon/open.ts
var DAEMON_BUSY_TIMEOUT_MS = 5e3;
async function openDaemon(rootArgument, now) {
  let root;
  let commonDir;
  try {
    root = realpathSync3(rootArgument);
    if (!existsSync7(join12(root, ".git"))) throw new Error(`${root} has no .git entry`);
    const out = await runGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
    commonDir = realpathSync3(out.trim());
  } catch (error) {
    return exit(
      "not-a-worktree",
      1,
      `${rootArgument} is not a git worktree root: ${message(error)}`
    );
  }
  const worktreeId = worktreeIdFor(root);
  let lock2;
  try {
    lock2 = acquireDaemonLock(lockFileFor(commonDir, worktreeId));
  } catch (error) {
    return exit("start-failed", 1, `could not take the daemon lock: ${message(error)}`);
  }
  if (lock2 === null) return exit("lost-lock", 0, `another daemon serves ${root}`);
  let store;
  try {
    const opened = openStore(commonDir, {
      checkIntegrity: true,
      busyTimeoutMs: DAEMON_BUSY_TIMEOUT_MS,
      now
    });
    if (isStoreOpenFailure(opened)) {
      lock2.release();
      if (opened.reason === "newer-schema") {
        const text = `daemon exited: store schema ${opened.found} is newer than this Squeal (supports ${opened.supported})`;
        noteInNewerStore(commonDir, worktreeId, { at: now(), revision: null, text });
        return exit("store-newer", 1, text);
      }
      return exit("store-unusable", 1, `store unusable: ${JSON.stringify(opened)}`);
    }
    store = opened;
  } catch (error) {
    lock2.release();
    return exit("store-unusable", 1, `store unusable: ${message(error)}`);
  }
  let prepared;
  try {
    prepared = prepareScratch(daemonScratch(commonDir, root));
  } catch (error) {
    const text = `could not prepare a temp directory: ${message(error)}`;
    return giveUp({ worktreeId, store, lock: lock2 }, now, () => {
    }, text);
  }
  const { scratch, refusal, leftovers } = prepared;
  if (refusal !== null) {
    writeNote(store, worktreeId, { at: now(), revision: null, text: refusal }, () => {
    });
  }
  return { root, commonDir, worktreeId, store, lock: lock2, scratch, leftovers };
}
async function abandon(opened, now, log, text) {
  const report2 = log ?? (() => {
  });
  await opened.leftovers;
  try {
    removeScratch(opened.scratch);
  } catch (error) {
    report2(`shutdown: temp dir removal failed: ${message(error)}`);
  }
  return giveUp(opened, now, report2, text);
}
function giveUp(opened, now, report2, text) {
  writeNote(opened.store, opened.worktreeId, { at: now(), revision: null, text }, report2);
  try {
    opened.store.close();
  } catch (error) {
    report2(`shutdown: store.close failed: ${message(error)}`);
  }
  opened.lock.release();
  return exit("start-failed", 1, text);
}
function exit(reason2, code, text) {
  return { reason: reason2, code, message: text };
}
function message(error) {
  return error instanceof Error ? error.message : String(error);
}

// src/core/daemon/daemon.ts
init_policy2();
async function startDaemon(options) {
  const now = options.now ?? Date.now;
  const desk = prepareFrontDesk();
  const opened = await openDaemon(options.root, now);
  if ("reason" in opened) {
    desk.discard();
    return opened;
  }
  let daemon;
  try {
    const env = options.env ?? { ...process.env };
    if (options.ownsProcess) adoptScratch(opened.scratch);
    daemon = new Daemon(opened, { ...options, env });
  } catch (error) {
    desk.discard();
    return abandon(opened, now, options.log, `daemon exited: could not start: ${message(error)}`);
  }
  return daemon.start(desk);
}
var Daemon = class {
  constructor(opened, options) {
    this.opened = opened;
    this.options = options;
    this.#log = options.log ?? (() => {
    });
    this.#now = options.now ?? Date.now;
    this.#socketPath = socketPathFor(opened.worktreeId, options.env);
    this.#startedAt = this.#now();
    this.#lastActive = this.#startedAt;
  }
  opened;
  options;
  #log;
  #now;
  #socketPath;
  #startedAt;
  #version = squealVersion();
  #phase = "starting";
  #policy = DEFAULT_POLICY;
  #desk = null;
  #runner = null;
  #loop = null;
  #starting = Promise.resolve();
  #stopTimers = () => {
  };
  #lastActive;
  #exit = null;
  #resolveExit = () => {
  };
  #exited = new Promise((resolve7) => {
    this.#resolveExit = resolve7;
  });
  async start(desk) {
    const { root, worktreeId } = this.opened;
    try {
      prepareSocketDir(this.#socketPath, this.options.env);
    } catch (error) {
      desk.discard();
      return this.#shutdown("start-failed", 1, `could not start serving: ${message(error)}`);
    }
    try {
      this.#desk = await this.#openDesk(desk);
      this.#register();
    } catch (error) {
      return this.#shutdown("start-failed", 1, `could not start serving: ${message(error)}`);
    }
    try {
      const { policy, problems } = loadPolicy(root);
      this.#policy = policy;
      this.#notePolicyProblems(problems);
      this.#startTimers();
    } catch (error) {
      return this.#shutdown("start-failed", 1, `daemon exited: could not start: ${message(error)}`);
    }
    this.#starting = this.#run();
    const ready = this.#starting.catch(() => {
    });
    return {
      root,
      worktreeId,
      socketPath: this.#socketPath,
      ready,
      exited: this.#exited,
      stop: (reason2) => this.#shutdown(reason2, 0, `daemon stopped: ${reason2}`)
    };
  }
  /** (Re)starts heartbeat, lifecycle checks and pruning with the current policy. */
  #startTimers() {
    this.#stopTimers();
    this.#stopTimers = startTimers({
      ...this.opened,
      policy: this.#policy,
      now: this.#now,
      linkedDir: linkedWorktreeDir(this.opened.root),
      timings: this.options.timings ?? {},
      heartbeatMs: this.#heartbeatMs(),
      lastActive: () => this.#lastActive,
      active: (at) => {
        this.#lastActive = at;
      },
      note: (text) => this.#note(text),
      log: this.#log,
      shutdown: (reason2, text) => void this.#shutdown(reason2, 0, text)
    });
  }
  /**
   * Spec 001 D11: a bad policy is a state; "the daemon persists one note and
   * keeps running". One note per distinct problem set: a restart that finds
   * the same problems as the last policy note adds none.
   */
  #notePolicyProblems(problems) {
    if (problems.length === 0) return;
    const text = `${POLICY_FILE}: ${describeProblems(problems)}`;
    if (lastPolicyNote(this.opened.store, this.opened.worktreeId) === text) {
      this.#log(text);
      return;
    }
    this.#note(text);
  }
  /**
   * `SchedulerOptions.reloadPolicy`: spec 001 D11, "a revision that changes
   * the file reloads it and re-keys what `inputs` and `env.allowlist`
   * touch". The scheduler re-keys; the daemon restarts its timers for
   * `daemon.*` and `store.*` and notes the reload.
   */
  #reloadPolicy() {
    const { policy, problems } = loadPolicy(this.opened.root);
    this.#policy = policy;
    if (this.#phase !== "stopping") this.#startTimers();
    const found = problems.length > 0 ? `: ${describeProblems(problems)}` : "";
    this.#note(`${POLICY_FILE} changed; policy reloaded${found}`);
    return policy;
  }
  #heartbeatMs() {
    return this.options.timings?.heartbeatMs ?? 5e3;
  }
  /** Review wave 2 input 4: `worktrees.upsert`, then `setDaemon` with the socket and a heartbeat. */
  #register() {
    const { store, worktreeId: id, root, commonDir } = this.opened;
    store.transaction(() => {
      const existing = store.worktrees.get(id);
      store.worktrees.upsert({
        id,
        root,
        commonDir,
        isMain: linkedWorktreeDir(root) === null,
        registeredAt: existing?.registeredAt ?? this.#startedAt,
        daemon: null
      });
      store.worktrees.setDaemon(id, {
        socketPath: this.#socketPath,
        startedAt: this.#startedAt,
        heartbeatAt: this.#now(),
        heartbeatIntervalMs: this.#heartbeatMs(),
        squealVersion: this.#version
      });
    });
  }
  /** Runner, sink and loop. The heavy modules load here, after the socket is up. */
  async #run() {
    const { root, worktreeId, store, commonDir } = this.opened;
    try {
      const [{ createDaemonLoop: createDaemonLoop2 }, { createStateSink: createStateSink2, describeFailure: describeFailure2 }, vitest, runnerModule] = await Promise.all([
        Promise.resolve().then(() => (init_daemon_loop(), daemon_loop_exports)),
        Promise.resolve().then(() => (init_state2(), state_exports)),
        Promise.resolve().then(() => (init_vitest(), vitest_exports)),
        Promise.resolve().then(() => (init_runner(), runner_exports))
      ]);
      const { storePaths: storePaths2 } = await Promise.resolve().then(() => (init_store2(), store_exports));
      const runner = runnerModule.createRecoveringRunner({
        name: "vitest",
        adapterVersion: vitest.VITEST_ADAPTER_VERSION,
        create: () => vitest.createVitestAdapter({ root, note: (text) => this.#note(text) }),
        onFailure: (text) => this.#note(`${text}; every check of this worktree is unknown until the config loads`),
        onRecovered: () => this.#note("Vitest started after the config changed"),
        around: this.options.ownsProcess ? inRootWhileRunning(root, this.opened.scratch) : void 0
      });
      this.#runner = runner;
      await runner.open();
      if (this.#phase === "stopping") return;
      const loop = createDaemonLoop2({
        root,
        worktreeId,
        store,
        runner,
        sink: createStateSink2(store, { now: this.#now }),
        policy: this.#policy,
        reloadPolicy: (changes) => changes.some((change) => change.path === POLICY_FILE) ? this.#reloadPolicy() : null,
        squealVersion: this.#version,
        runsDir: storePaths2(commonDir).runsDir,
        describeFailure: describeFailure2,
        now: this.#now,
        onError: (error) => this.#note(`daemon error: ${error.message}`),
        onDropped: (reason2) => this.#note(`watcher dropped events (${reason2}); a full reconciliation follows`)
      });
      this.#loop = loop;
      await loop.start();
      this.#lastActive = this.#now();
      if (this.#phase === "starting") this.#setPhase("ready");
      this.#log(`serving ${root} on ${this.#socketPath}`);
    } catch (error) {
      void this.#shutdown("start-failed", 1, `daemon exited: could not start: ${message(error)}`);
      throw error;
    }
  }
  #openDesk(desk) {
    return desk.open(
      {
        socketPath: this.#socketPath,
        worktreeId: this.opened.worktreeId,
        root: this.opened.root,
        squealVersion: this.#version,
        startedAt: this.#startedAt
      },
      {
        requestFullSuite: (force) => this.#requestFullSuite(force),
        onActivity: () => {
          this.#lastActive = this.#now();
        },
        // After the answer is written.
        onStop: () => setImmediate(
          () => void this.#shutdown("stop-requested", 0, "daemon stopped: squeal stop")
        ),
        onFailure: (error) => void this.#shutdown("start-failed", 1, `daemon exited: socket failed: ${error.message}`)
      }
    );
  }
  #setPhase(phase) {
    this.#phase = phase;
    this.#desk?.setPhase(phase);
  }
  async #requestFullSuite(force) {
    await this.#starting;
    if (this.#loop === null || this.#phase === "stopping") {
      throw new Error("the daemon is not running a scheduler");
    }
    this.#runner?.retry();
    return this.#loop.scheduler.requestFullSuite({ force });
  }
  #note(text) {
    this.#log(text);
    const revision = this.#loop?.scheduler.status().revision ?? null;
    writeNote(
      this.opened.store,
      this.opened.worktreeId,
      { at: this.#now(), revision, text },
      () => {
      }
    );
  }
  /**
   * Spec 001 D10 and the review's shutdown order: `loop.close()` (waits for
   * the tier in flight, abandons the open checkpoint), `runner.close()`, the
   * temp directory once its leftovers are gone, `setDaemon(null)`,
   * `store.close()`. Then the socket, which closing unlinks, and last the
   * lock, so a successor never sees this daemon's socket go away after
   * binding its own.
   */
  #shutdown(reason2, code, text) {
    this.#exit ??= (async () => {
      this.#setPhase("stopping");
      this.#stopTimers();
      this.#note(text);
      await this.#starting.catch(() => {
      });
      const { store, worktreeId, lock: lock2 } = this.opened;
      await this.#step("loop.close", () => this.#loop?.close());
      await this.#step("runner.close", () => this.#runner?.close());
      await this.#step("temp dir removal", async () => {
        await this.opened.leftovers;
        removeScratch(this.opened.scratch);
      });
      await this.#step("setDaemon", () => store.worktrees.setDaemon(worktreeId, null));
      await this.#step("store.close", () => store.close());
      await this.#step("socket close", () => this.#desk?.close());
      await this.#step("lock release", () => lock2.release());
      const result = exit(reason2, code, text);
      this.#resolveExit(result);
      return result;
    })();
    return this.#exit;
  }
  async #step(name, fn) {
    try {
      await fn();
    } catch (error) {
      this.#log(`shutdown: ${name} failed: ${message(error)}`);
    }
  }
};

// src/core/daemon/signals.ts
var OWNED = /* @__PURE__ */ new Set(["SIGINT", "SIGTERM", "SIGHUP"]);
var METHODS2 = ["on", "once", "addListener", "prependListener", "prependOnceListener"];
function ownSignals(onSignal) {
  const originals = METHODS2.map((name) => [name, process[name]]);
  for (const signal of OWNED) process.on(signal, onSignal);
  for (const [name, original] of originals) {
    const guarded = function(event, ...rest) {
      if (OWNED.has(event)) return process;
      return Reflect.apply(original, this, [event, ...rest]);
    };
    process[name] = guarded;
  }
  return () => {
    for (const [name, original] of originals) process[name] = original;
    for (const signal of OWNED) process.off(signal, onSignal);
  };
}

// src/cli/daemon.ts
var USAGE = "usage: squeal daemon <root>\n";
async function daemonCommand(args, io) {
  const [root, ...extra] = args;
  if (root === void 0 || root.startsWith("-") || extra.length > 0) {
    io.stderr(USAGE);
    return 2;
  }
  const log = (line) => io.stderr(`squeal daemon: ${line}
`);
  let signalled = false;
  let stop = () => {
    signalled = true;
  };
  const restore2 = ownSignals(() => stop());
  try {
    const daemon = await startDaemon({ root, log, ownsProcess: true });
    if ("reason" in daemon) {
      log(daemon.message);
      return daemon.code;
    }
    stop = () => void daemon.stop("signal");
    if (signalled) stop();
    const exit2 = await daemon.exited;
    log(exit2.message);
    setTimeout(() => process.exit(exit2.code), 2e3).unref();
    return exit2.code;
  } finally {
    restore2();
  }
}

// src/cli/init.ts
init_fs();
init_types();
import { existsSync as existsSync11, mkdirSync as mkdirSync8, readFileSync as readFileSync8, rmSync as rmSync6, writeFileSync as writeFileSync3 } from "node:fs";
import { join as join25 } from "node:path";
var MARKETPLACE_NAME = "squeal";
var PLUGIN_ID = `squeal@${MARKETPLACE_NAME}`;
var MARKETPLACE_SOURCE = {
  source: { source: "github", repo: "hearsay-tools/squeal" }
};
var isObject2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
function init(args, io) {
  if (args.length > 0) {
    io.stderr("squeal init: takes no arguments\n\nUsage: squeal init\n");
    return 2;
  }
  const cwd = io.cwd ?? process.cwd();
  const root = findWorktreeRoot(cwd);
  if (root === null) {
    io.stderr(`squeal init: ${cwd} is not inside a git worktree
`);
    return 1;
  }
  const settingsPath = join25(root, ".claude", "settings.json");
  const settings = readSettings(settingsPath);
  if (typeof settings === "string") {
    io.stderr(`squeal init: ${settings}; nothing changed
`);
    return 1;
  }
  const marketplaces = settings.value.extraKnownMarketplaces ?? {};
  const plugins = settings.value.enabledPlugins ?? {};
  for (const [key, value] of [
    ["extraKnownMarketplaces", marketplaces],
    ["enabledPlugins", plugins]
  ]) {
    if (!isObject2(value)) {
      io.stderr(`squeal init: ${key} in ${settingsPath} is not an object; nothing changed
`);
      return 1;
    }
  }
  const lines = [];
  const configPath = join25(root, "squeal.config.json");
  const writeConfig = !existsSync11(configPath);
  lines.push(
    writeConfig ? "wrote squeal.config.json with every default policy key" : "kept squeal.config.json"
  );
  const next = { ...settings.value };
  const marketplaceEntries = marketplaces;
  if (MARKETPLACE_NAME in marketplaceEntries) {
    lines.push("kept the squeal marketplace entry in .claude/settings.json");
  } else {
    next.extraKnownMarketplaces = { ...marketplaceEntries, [MARKETPLACE_NAME]: MARKETPLACE_SOURCE };
    lines.push("added the squeal marketplace to .claude/settings.json");
  }
  const pluginEntries = plugins;
  if (pluginEntries[PLUGIN_ID] === true) {
    lines.push(`.claude/settings.json already enables ${PLUGIN_ID}`);
  } else {
    next.enabledPlugins = { ...pluginEntries, [PLUGIN_ID]: true };
    lines.push(`enabled ${PLUGIN_ID} in .claude/settings.json`);
  }
  const text = `${JSON.stringify(next, null, settings.indent)}
`;
  const restore2 = text === settings.text ? () => {
  } : restorer(settingsPath, settings.text);
  try {
    if (text !== settings.text) {
      mkdirSync8(join25(root, ".claude"), { recursive: true });
      writeFileSync3(settingsPath, text);
    }
  } catch (error) {
    restore2();
    io.stderr(`squeal init: could not write ${settingsPath}: ${reason(error)}; nothing changed
`);
    return 1;
  }
  try {
    if (writeConfig) writeFileSync3(configPath, `${JSON.stringify(DEFAULT_POLICY, null, 2)}
`);
  } catch (error) {
    restore2();
    io.stderr(`squeal init: could not write ${configPath}: ${reason(error)}; nothing changed
`);
    return 1;
  }
  io.stdout(
    [
      ...lines.map((line) => `squeal init: ${line}`),
      `Each collaborator installs the plugin once: claude plugin install ${PLUGIN_ID} --scope project`,
      ""
    ].join("\n")
  );
  return 0;
}
function restorer(path, text) {
  return () => {
    try {
      if (text === null) rmSync6(path, { force: true });
      else writeFileSync3(path, text);
    } catch {
    }
  };
}
function reason(error) {
  return error instanceof Error ? error.message : String(error);
}
function readSettings(path) {
  if (!existsSync11(path)) return { value: {}, text: null, indent: 2 };
  const text = readFileSync8(path, "utf8");
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    value = null;
  }
  if (!isObject2(value)) return `${path} is not a JSON object`;
  return { value, text, indent: /^([ \t]+)"/m.exec(text)?.[1] ?? 2 };
}

// src/cli/run.ts
init_store2();

// src/core/daemon/client.ts
import { createConnection } from "node:net";
function requestDaemon(socketPath, request, timeoutMs) {
  return new Promise((resolve7, reject) => {
    const socket = createConnection(socketPath);
    let buffer = "";
    let settled = false;
    const settle = (error, response) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve7(response);
    };
    const timer = setTimeout(
      () => settle(failure("ETIMEDOUT", `no answer from ${socketPath} in ${timeoutMs} ms`)),
      timeoutMs
    );
    socket.setEncoding("utf8");
    socket.on("connect", () => socket.write(`${JSON.stringify(request)}
`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      try {
        settle(null, JSON.parse(buffer.slice(0, end)));
      } catch {
        settle(failure("EPROTO", `malformed answer from ${socketPath}`));
      }
    });
    socket.on(
      "error",
      (error) => settle(failure(error.code ?? "EIO", error.message))
    );
    socket.on(
      "close",
      () => settle(failure("ECONNRESET", `${socketPath} closed without an answer`))
    );
  });
}
function failure(code, message2) {
  return Object.assign(new Error(message2), { code });
}

// src/core/daemon/ensure.ts
import { spawn as spawn2 } from "node:child_process";
import { existsSync as existsSync12, mkdirSync as mkdirSync9 } from "node:fs";
init_open();
init_paths2();
init_types();
async function probeDaemon(root, timeoutMs, options = {}) {
  try {
    return (await locateDaemon(root, timeoutMs, options)).probe;
  } catch (error) {
    return { state: "unresponsive", reason: `no worktree at ${root}: ${String(error)}` };
  }
}
async function locateDaemon(root, timeoutMs, options = {}) {
  const socketPath = socketPathFor(worktreeIdFor(root), options.env);
  const record = options.record === void 0 ? recordedDaemon(root) : options.record;
  const now = options.now ?? Date.now;
  if (record !== null && record.socketPath !== socketPath && daemonLiveness(record, now()).state === "alive") {
    const probe = await ping(record.socketPath, timeoutMs);
    if (probe.state !== "absent") return { socketPath: record.socketPath, probe };
  }
  return { socketPath, probe: await ping(socketPath, timeoutMs) };
}
async function ping(socketPath, timeoutMs) {
  try {
    const response = await requestDaemon(socketPath, { type: "ping" }, timeoutMs);
    if (response.ok && response.type === "ping") return { state: "alive", ping: response };
    return { state: "unresponsive", reason: `unexpected answer: ${JSON.stringify(response)}` };
  } catch (error) {
    const code = noDaemonCode(error);
    if (code !== null) return { state: "absent", code };
    return { state: "unresponsive", reason: error.message };
  }
}
function noDaemonCode(error) {
  const code = error?.code;
  return code === "ENOENT" || code === "ECONNREFUSED" ? code : null;
}
function recordedDaemon(root, busyTimeoutMs = 100) {
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return null;
    const store = openStore(commonDir, { create: false, busyTimeoutMs });
    if (isStoreOpenFailure(store)) return null;
    try {
      return store.worktrees.get(worktreeIdFor(root))?.daemon ?? null;
    } finally {
      store.close();
    }
  } catch {
    return null;
  }
}
async function ensureDaemon(root, options = {}) {
  const probe = await probeDaemon(
    root,
    options.socketTimeoutMs ?? DAEMON_SOCKET_TIMEOUT_MS,
    options
  );
  if (probe.state === "alive") return "alive";
  if (probe.state === "unresponsive") return "unavailable";
  const cli = daemonCliEntry(options.cli, options.env);
  if (cli === null || !existsSync12(cli)) return "unavailable";
  try {
    const commonDir = resolveCommonDir(root);
    if (commonDir === null) return "unavailable";
    const cwd = storePaths(commonDir).dir;
    mkdirSync9(cwd, { recursive: true });
    const child = spawn2(process.execPath, [cli, "daemon", root], {
      cwd,
      detached: true,
      stdio: "ignore"
    });
    child.on("error", () => {
    });
    child.unref();
    return "spawned";
  } catch {
    return "unavailable";
  }
}
function daemonCliEntry(cli, env = process.env) {
  const override = env.SQUEAL_CLI;
  if (override !== void 0 && override !== "") return override;
  return cli ?? null;
}

// src/cli/daemon-access.ts
init_fs();
var CLI_SOCKET_TIMEOUT_MS = 2e3;
function worktreeRoot(path, io) {
  const from = path ?? io.cwd ?? process.cwd();
  const root = findWorktreeRoot(from);
  if (root === null) io.stderr(`squeal: ${from} is not inside a git worktree
`);
  return root;
}
async function daemonSocket(root) {
  const record = recordedDaemon(root, 1e3);
  return (await locateDaemon(root, CLI_SOCKET_TIMEOUT_MS, { record })).socketPath;
}
async function askDaemon(socketPath, request) {
  try {
    return await requestDaemon(socketPath, request, CLI_SOCKET_TIMEOUT_MS);
  } catch (error) {
    if (noDaemonCode(error) !== null) return null;
    throw error;
  }
}
function delay(ms) {
  return new Promise((resolve7) => setTimeout(resolve7, ms));
}

// src/cli/run.ts
var USAGE2 = "usage: squeal run --all [--force] [--wait]\n";
var RECORD_WAIT_MS = 1e4;
var POLL_MS = 100;
async function runCommand(args, io) {
  const flags = new Set(args);
  const unknown = args.filter((a) => !["--all", "--force", "--wait"].includes(a));
  if (!flags.has("--all") || unknown.length > 0) {
    io.stderr(
      `squeal run: ${unknown.length > 0 ? `unknown argument "${unknown[0]}"` : "--all is required"}
${USAGE2}`
    );
    return 2;
  }
  const root = worktreeRoot(void 0, io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const response = await askDaemon(socketPath, { type: "run-all", force: flags.has("--force") });
  if (response === null) {
    io.stderr(`squeal: no daemon running for ${root}; start one with squeal start
`);
    return 1;
  }
  if (!response.ok || response.type !== "run-all") {
    io.stderr(`squeal: run --all failed: ${response.ok ? "unexpected answer" : response.error}
`);
    return 1;
  }
  const wait = flags.has("--wait");
  const checkpoint = await recorded(socketPath, response, wait ? null : RECORD_WAIT_MS, io);
  if (checkpoint === null) return 1;
  io.stdout(
    `Checkpoint ${checkpoint.id} started at revision ${checkpoint.revision}: ${checkpoint.testFiles.length} test files
`
  );
  if (!wait) return 0;
  const end = await ended(root, socketPath, checkpoint.id);
  if (end === null) {
    io.stderr(`squeal: the daemon stopped before checkpoint ${checkpoint.id} ended
`);
    return 1;
  }
  io.stdout(`Checkpoint ${checkpoint.id} ${end}

`);
  const now = io.now ?? Date.now;
  io.stdout(formatStatus(readStatus(root, { now }), now()));
  return end === "completed" ? 0 : 1;
}
async function recorded(socketPath, first, timeoutMs, io) {
  const deadline = timeoutMs === null ? Number.POSITIVE_INFINITY : Date.now() + timeoutMs;
  let state = first;
  for (; ; ) {
    if (state.checkpoint !== null) return state.checkpoint;
    if (state.error !== null) {
      io.stderr(`squeal: run --all failed: ${state.error}
`);
      return null;
    }
    if (Date.now() > deadline) {
      io.stdout(
        `Run requested (request ${first.requestId}); the daemon records the checkpoint once its current work allows
`
      );
      return null;
    }
    await delay(POLL_MS);
    const next = await askDaemon(socketPath, {
      type: "run-all-status",
      requestId: first.requestId
    });
    if (next === null || !next.ok || next.type !== "run-all") {
      io.stderr("squeal: the daemon stopped before recording the checkpoint\n");
      return null;
    }
    state = next;
  }
}
async function ended(root, socketPath, id) {
  const commonDir = resolveCommonDir(root);
  if (commonDir === null) return null;
  for (let polls = 0; ; polls++) {
    const store = openStore(commonDir, { create: false, busyTimeoutMs: 1e3 });
    if (isStoreOpenFailure(store)) return null;
    let end;
    try {
      end = store.checkpoints.get(id)?.end ?? null;
    } finally {
      store.close();
    }
    if (end !== null) return end;
    if (polls % 20 === 19 && await askDaemon(socketPath, { type: "ping" }) === null) return null;
    await delay(250);
  }
}

// src/cli/start.ts
var SPAWN_WAIT_MS = 1e4;
async function startCommand(args, io) {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal start [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  const cli = process.argv[1];
  const result = await ensureDaemon(root, cli === void 0 ? {} : { cli });
  if (result === "unavailable") {
    io.stderr(`squeal: no daemon could be reached or started for ${root}
`);
    return 1;
  }
  if (result === "spawned") {
    const deadline = Date.now() + SPAWN_WAIT_MS;
    while ((await probeDaemon(root, 100)).state !== "alive") {
      if (Date.now() > deadline) {
        io.stderr(`squeal: spawned a daemon for ${root}, but it did not answer
`);
        return 1;
      }
      await delay(50);
    }
  }
  io.stdout(`Squeal daemon ${result} for ${root}

`);
  const now = io.now ?? Date.now;
  io.stdout(formatStatus(readStatus(root, { now }), now()));
  return 0;
}

// src/cli/status-wait.ts
import { setTimeout as sleep } from "node:timers/promises";
init_state2();
init_store2();
var STATUS_WAIT_POLL_MS = 250;
var STATUS_WAIT_SETTLE_MS = 750;
async function waitForStatus(cwd, options) {
  const now = options.now ?? Date.now;
  const pollMs = options.pollMs ?? STATUS_WAIT_POLL_MS;
  const settleMs = options.settleMs ?? STATUS_WAIT_SETTLE_MS;
  const started = performance.now();
  const elapsed = () => performance.now() - started;
  let start = null;
  for (; ; ) {
    const final = elapsed() >= options.timeoutMs;
    const left = options.timeoutMs - elapsed();
    const busyTimeoutMs = final ? STATUS_BUSY_TIMEOUT_MS : Math.round(Math.max(50, Math.min(STATUS_BUSY_TIMEOUT_MS, left)));
    const read3 = withStatusStore(cwd, { busyTimeoutMs }, ({ store, root }) => {
      const id = worktreeIdFor(root);
      const states = store.knownStates.list(id);
      const header = readHeader(store, id, states);
      start ??= states.map(toStartView);
      const transitions = countNews(start, states, header.revision);
      const settled = final || elapsed() >= settleMs;
      const daemon = worktreeLiveness(store.worktrees.get(id), now());
      const outcome = transitions > 0 ? "news" : settled && daemon.state !== "alive" ? "no-daemon" : settled && !isPending(header) ? "quiet" : final ? "timeout" : null;
      return outcome === null ? null : { outcome, transitions, result: buildSnapshot(store, root, now()) };
    });
    if (read3 !== null && "available" in read3) {
      if (start === null || final) {
        return { outcome: "unavailable", waitedMs: elapsed(), result: read3 };
      }
    } else if (read3 !== null) {
      return { ...read3, waitedMs: elapsed() };
    }
    const remaining = options.timeoutMs - elapsed();
    if (remaining > 0) await sleep(Math.min(pollMs, remaining));
  }
}
function toStartView(state) {
  return { check: state.check, outcome: state.outcome, fingerprint: state.fingerprint, toldAt: 0 };
}
function countNews(start, states, revision) {
  return planDelta({
    view: start,
    states,
    isBaselineFinding: () => false,
    toldAt: 0,
    rootOf: () => null,
    revision
  }).entries.length;
}
async function statusWaitCommand(timeoutMs, json3, io) {
  const now = io.now ?? Date.now;
  const wait = await waitForStatus(io.cwd ?? process.cwd(), { timeoutMs, now });
  const result = wait.result;
  if (wait.outcome === "unavailable") {
    io.stdout(json3 ? `${JSON.stringify(result, null, 2)}
` : formatStatus(result, now()));
    return 1;
  }
  const line = `${waitLine(wait.outcome, wait.transitions, wait.result, wait.waitedMs)}
`;
  if (json3) {
    const payload = {
      outcome: wait.outcome,
      waitedMs: Math.round(wait.waitedMs),
      transitions: wait.transitions
    };
    io.stdout(`${JSON.stringify({ ...result, wait: payload }, null, 2)}
`);
    io.stderr(line);
  } else {
    io.stdout(`${line}
${formatStatus(result, now())}`);
  }
  return 0;
}
function waitLine(outcome, transitions, snapshot2, waitedMs) {
  const after = `after ${(waitedMs / 1e3).toFixed(1)} s`;
  const at = `at revision ${snapshot2.revision}`;
  switch (outcome) {
    case "quiet":
      return `Returned on quiet: nothing pending ${at} ${after}`;
    case "news":
      return `Returned on news: ${transitions} ${plural2(transitions, "transition")} since the wait started, ${at} ${after}`;
    case "no-daemon":
      return `Returned without a daemon: ${noDaemonText(snapshot2.daemon)}; results are as of revision ${snapshot2.revision}`;
    case "timeout":
      return `Returned on timeout ${after}: ${pendingText(snapshot2)} ${at}`;
  }
}
function noDaemonText(daemon) {
  if (daemon.state === "alive" || daemon.since === null) return "no daemon is running";
  return `no daemon has validated since ${new Date(daemon.since).toISOString()}`;
}
function pendingText(snapshot2) {
  const checks = snapshot2.counts.pending;
  const files = snapshot2.testFilesWithoutChecks.pending;
  const parts = [`${checks} ${plural2(checks, "check")}`];
  if (files > 0) parts.push(`${files} test ${plural2(files, "file")} without checks`);
  if (snapshot2.runnerPartPending === true) parts.push(runnerPartText(snapshot2.revision));
  return parts.length === 1 ? `${parts[0]} pending` : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)} pending`;
}
function plural2(count, word) {
  return count === 1 ? word : `${word}s`;
}

// src/cli/stop.ts
var STOP_WAIT_MS = 6e4;
async function stopCommand(args, io) {
  if (args.length > 1 || args[0]?.startsWith("-")) {
    io.stderr("usage: squeal stop [root]\n");
    return 2;
  }
  const root = worktreeRoot(args[0], io);
  if (root === null) return 1;
  const socketPath = await daemonSocket(root);
  const response = await askDaemon(socketPath, { type: "stop" });
  if (response === null) {
    io.stdout(`No daemon running for ${root}
`);
    return 0;
  }
  if (!response.ok) {
    io.stderr(`squeal: the daemon refused to stop: ${response.error}
`);
    return 1;
  }
  const deadline = Date.now() + STOP_WAIT_MS;
  while (await askDaemon(socketPath, { type: "ping" }).catch(() => "busy") !== null) {
    if (Date.now() > deadline) {
      io.stdout(`Stop requested; the daemon for ${root} is finishing the tier in flight
`);
      return 0;
    }
    await delay(50);
  }
  io.stdout(`Squeal daemon stopped for ${root}
`);
  return 0;
}

// src/cli/main.ts
var HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal status [--json]        Current validation state of this worktree
  squeal status --wait <ms> [--json]
                                Wait up to <ms> until nothing is pending at the current
                                revision or a check changed, then print status
  squeal why <check> [--json]   History and provenance of one check
  squeal init                   Set up this repository: squeal.config.json and the
                                plugin entries in .claude/settings.json
  squeal start [root]           Start this worktree's daemon if none runs, print status
  squeal run --all [--force] [--wait]
                                Request a full-suite checkpoint from the daemon
  squeal stop [root]            Stop this worktree's daemon
  squeal daemon <root>          Run the daemon in the foreground (hooks start it)
  squeal --version              Print the version
  squeal --help                 Print this help

A check is named as in status output: "path > describe > test", or any
unique part of that name. Status reads the store directly; no daemon needed.
`;
function main(argv, io) {
  const [first, ...rest] = argv;
  if (first === "--version" || first === "-v") {
    io.stdout(`${squealVersion()}
`);
    return 0;
  }
  if (first === void 0 || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return 0;
  }
  if (first === "status") return status(rest, io);
  if (first === "why") return why(rest, io);
  if (first === "init") return init(rest, io);
  if (first === "daemon") return daemonCommand(rest, io);
  if (first === "start") return startCommand(rest, io);
  if (first === "run") return runCommand(rest, io);
  if (first === "stop") return stopCommand(rest, io);
  io.stderr(`squeal: unknown command "${first}"

${HELP}`);
  return 2;
}
function status(args, io) {
  const waitAt = args.findIndex((a) => a === "--wait" || a.startsWith("--wait="));
  let waitMs = null;
  let rest = args;
  if (waitAt !== -1) {
    const arg = args[waitAt];
    const inline = arg.startsWith("--wait=");
    const value = inline ? arg.slice("--wait=".length) : args[waitAt + 1];
    if (value === void 0 || !/^\d+$/.test(value)) {
      return usage("status", "--wait takes a whole number of milliseconds", io);
    }
    waitMs = Number(value);
    rest = args.filter((_, i) => i !== waitAt && (inline || i !== waitAt + 1));
  }
  const parsed = parseArgs("status", rest, io);
  if (parsed === null) return 2;
  if (parsed.positional.length > 0) return usage("status", "takes no arguments", io);
  if (waitMs !== null) return statusWaitCommand(waitMs, parsed.json, io);
  const now = io.now ?? Date.now;
  const result = readStatus(io.cwd ?? process.cwd(), { now });
  io.stdout(parsed.json ? json2(result) : formatStatus(result, now()));
  return result.available ? 0 : 1;
}
function why(args, io) {
  const parsed = parseArgs("why", args, io);
  if (parsed === null) return 2;
  const [name] = parsed.positional;
  if (name === void 0 || parsed.positional.length > 1) {
    return usage("why", "expected one check name", io);
  }
  const result = readWhy(io.cwd ?? process.cwd(), name);
  io.stdout(parsed.json ? json2(result) : formatWhy(result));
  return result.available && result.found ? 0 : 1;
}
function parseArgs(command, args, io) {
  let isJson = false;
  const positional = [];
  for (const arg of args) {
    if (arg === "--json") isJson = true;
    else if (arg.startsWith("--")) {
      usage(command, `unknown option "${arg}"`, io);
      return null;
    } else positional.push(arg);
  }
  return { json: isJson, positional };
}
function usage(command, problem, io) {
  io.stderr(`squeal ${command}: ${problem}

${HELP}`);
  return 2;
}
function json2(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}

// src/cli/index.ts
process.stdout.on("error", (error) => {
  if (error.code !== "EPIPE") throw error;
});
process.exitCode = await main(process.argv.slice(2), {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
  cwd: process.cwd()
});
