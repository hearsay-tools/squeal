import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { parse } from "acorn";
import { transformSync } from "esbuild";
import { describe, expect, it } from "vitest";

/*
 * Row 010-35 (spec 010 D5): `scripts/ci-shard.mjs` splits the suite into CI shards by measured
 * duration. Every test file runs in exactly one shard, a pin holds its file in its shard, an
 * excluded file runs in none, and the shards weigh about the same.
 */
const ROOT = join(import.meta.dirname, "..");
const SCRIPT = join(ROOT, "scripts/ci-shard.mjs");
const WORKFLOW = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");

interface Shard {
  files: string[];
  ms: number;
}
interface Options {
  index: number;
  count: number;
  pins: Map<string, number>;
  excludes: string[];
  print: boolean;
}
interface ShardModule {
  DEFAULT_MS: number;
  discover(root?: string): string[];
  readTimings(root?: string): Map<string, number>;
  parseArgs(argv: readonly string[]): Options;
  partition(
    files: readonly string[],
    count: number,
    timings: Map<string, number>,
    pins?: Map<string, number>,
  ): Shard[];
}
// A specifier TypeScript does not resolve: the script is plain JavaScript without declarations.
const MODULE: string = "../scripts/ci-shard.mjs";
const shard = (await import(MODULE)) as ShardModule;

const DISPOSE = "test/harness/opencode-dispose.test.ts";
const COMPARE = "test/keys/validity/compare.test.ts";

/*
 * Review 0.1.629, B1: only shard 1 checks out the full history, so the workflow pins there every
 * test file that reads this repository's history (a release tag or an old commit), itself or
 * through a helper it imports. The walk below finds them. It follows each test file's relative
 * imports under `test/`, transitively, and parses only the modules that reach one whose text could
 * read history (`mayRead`). It splits each into units: each named function and the module's own top
 * level. A unit reads history when it runs git with a reading verb on this repository or on a
 * `squeal--v*` tag, reads `reference.commit`, is one of `SEEDS`, or calls a reading unit defined in
 * a module it reaches. A module whose top level reads makes its importers' top level read. A test
 * file reads when any of its units does.
 */
const SEEDS = ["lastRelease", "hasCommit", "extractTree"];
const GIT_READS = ["archive", "cat-file", "describe", "log", "ls-tree", "rev-list", "show"];
/** This repository's root, as the test helpers name it. */
const THIS_REPO = /\b(?:ROOT|REPO_ROOT|repoRoot)\b/;
const SEED_NAMES = new RegExp(`\\b(?:${SEEDS.join("|")})\\b`);
const QUOTED_READS = new RegExp(`["'](?:${GIT_READS.join("|")})["']`);
/** A superset of the text a reading unit holds: a module without it reads nothing itself. */
const mayRead = (text: string) =>
  /\breference\.commit\b/.test(text) ||
  SEED_NAMES.test(text) ||
  (QUOTED_READS.test(text) && (THIS_REPO.test(text) || text.includes("squeal--v")));
/** `from "./x.js"`, `import "./x.js"` and `import("./x.js")`, in code or not: a superset. */
const IMPORTS = /\b(?:from|import)\s*\(?\s*["'](\.\.?\/[^"']+)["']/g;
/** Files the walk finds that read no history, each with the reason. */
const NO_HISTORY = new Map([
  [
    "test/e2e/run-triggers.test.ts",
    "calls `pluginAt(e)` with no ref: it copies the checkout's plugin",
  ],
]);

/** A node of acorn's tree, read loosely. */
interface AstNode {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
}
interface Unit {
  name: string | null;
  direct: boolean;
  calls: Set<string>;
}

const isNode = (value: unknown): value is AstNode =>
  typeof value === "object" && value !== null && typeof (value as AstNode).type === "string";
const children = (node: AstNode): AstNode[] =>
  Object.values(node).flatMap((value) =>
    Array.isArray(value) ? value.filter(isNode) : isNode(value) ? [value] : [],
  );
const nameOf = (node: unknown): string | undefined =>
  isNode(node) && node.type === "Identifier" ? (node.name as string) : undefined;
const isFunction = (node: unknown) =>
  isNode(node) && /^(?:Arrow)?Function(?:Expression|Declaration)$/.test(node.type);
const stringOf = (node: AstNode) => (typeof node.value === "string" ? node.value : undefined);

/** The name a function takes from its declaration, declarator, property or method. */
function functionName(node: AstNode): string | undefined {
  if (node.type === "FunctionDeclaration") return nameOf(node.id);
  if (node.type === "VariableDeclarator" && isFunction(node.init)) return nameOf(node.id);
  if (
    /^(?:Property|MethodDefinition|PropertyDefinition)$/.test(node.type) &&
    isFunction(node.value)
  )
    return node.computed === true ? undefined : nameOf(node.key);
  return undefined;
}

/** A relative import's file under `test/`, fixtures out; null for one in another tree. */
function resolveImport(from: string, specifier: string, root: string): string | null {
  const path = posix.join(posix.dirname(from), specifier);
  const found = [path.replace(/\.js$/, ".ts"), path, `${path}.ts`, `${path}/index.ts`].find(
    (each) => /\.[mc]?[jt]s$/.test(each) && existsSync(join(root, each)),
  );
  if (found === undefined || !found.startsWith("test/") || found.startsWith("test/fixtures/"))
    return null;
  return found;
}

/** The module's units: its top level first, then each named function. */
function unitsOf(text: string): Unit[] {
  // esbuild, not Node's type stripping, which refuses parameter properties.
  const code = transformSync(text, { loader: "ts" }).code;
  const program = parse(code, { ecmaVersion: "latest", sourceType: "module" }) as unknown;
  const units: Unit[] = [{ name: null, direct: false, calls: new Set() }];
  const visit = (node: AstNode, outer: Unit): void => {
    let unit = outer;
    const name = functionName(node);
    if (name !== undefined) {
      unit = { name, direct: false, calls: new Set() };
      units.push(unit);
    }
    if (node.type === "MemberExpression" && nameOf(node.object) === "reference")
      if (nameOf(node.property) === "commit") unit.direct = true;
    if (node.type === "CallExpression") {
      const callee = node.callee as AstNode;
      const called = nameOf(callee) ?? (callee.computed ? undefined : nameOf(callee.property));
      if (called !== undefined) unit.calls.add(called);
      const words: string[] = [];
      const collect = (each: AstNode): void => {
        const word = stringOf(each);
        if (word !== undefined) words.push(word);
        for (const child of children(each)) collect(child);
      };
      for (const argument of node.arguments as AstNode[]) collect(argument);
      const git = called === "git" || words[0] === "git";
      const onRepo =
        words.some((word) => word.startsWith("squeal--v")) ||
        THIS_REPO.test(code.slice(node.start, node.end));
      if (git && onRepo && words.some((word) => GIT_READS.includes(word))) unit.direct = true;
    }
    for (const child of children(node)) visit(child, unit);
  };
  visit(program as AstNode, units[0] as Unit);
  return units;
}

/**
 * The modules `files` import under `test/`, transitively, by path: each one's text and its
 * imports, and what it reaches, itself included, for each that reaches a `mayRead` module.
 */
function importGraph(files: readonly string[], root: string) {
  const texts = new Map<string, string>();
  const imports = new Map<string, string[]>();
  const load = (path: string): void => {
    if (texts.has(path)) return;
    const text = readFileSync(join(root, path), "utf8");
    texts.set(path, text);
    const found = [...text.matchAll(IMPORTS)].map((match) =>
      resolveImport(path, match[1] ?? "", root),
    );
    imports.set(path, [...new Set(found.filter((each) => each !== null))]);
    for (const each of imports.get(path) ?? []) load(each);
  };
  for (const path of files) load(path);
  const reachable = new Map<string, Set<string>>();
  for (const path of texts.keys()) {
    const found = new Set([path]);
    for (const at of found) for (const each of imports.get(at) ?? []) found.add(each);
    if ([...found].some((at) => mayRead(texts.get(at) ?? ""))) reachable.set(path, found);
  }
  return { texts, imports, reachable };
}

/** The test files among `files` that read this repository's history, directly or through helpers. */
function historyReaders(files: readonly string[], root = ROOT): string[] {
  const { texts, imports, reachable } = importGraph(files, root);
  const units = new Map(
    [...reachable.keys()].map((path) => [path, unitsOf(texts.get(path) ?? "")]),
  );
  const defined = new Map<string, Set<string>>();
  const reads = new Set<Unit>();
  const readsHistory = (path: string, unit: Unit): boolean => {
    if (unit.direct || (unit.name !== null && SEEDS.includes(unit.name))) return true;
    if (unit.name === null)
      for (const each of imports.get(path) ?? [])
        if (reads.has(units.get(each)?.[0] as Unit)) return true;
    const reaches = reachable.get(path) ?? new Set();
    return [...unit.calls].some((name) =>
      [...(defined.get(name) ?? [])].some((at) => reaches.has(at)),
    );
  };
  for (let grew = true; grew; ) {
    grew = false;
    for (const [path, own] of units)
      for (const unit of own) {
        if (reads.has(unit) || !readsHistory(path, unit)) continue;
        reads.add(unit);
        if (unit.name !== null)
          defined.set(unit.name, (defined.get(unit.name) ?? new Set()).add(path));
        grew = true;
      }
  }
  for (const seed of SEEDS)
    if (!defined.has(seed)) throw new Error(`no module under test/ defines ${seed} any more`);
  return files.filter((path) => units.get(path)?.some((unit) => reads.has(unit)));
}

/** The pins and the exclude the workflow passes the script, for any shard count. */
function workflowArgs(): string[] {
  const pins = [...WORKFLOW.matchAll(/--pin (\S+):1\b/g)].map((match) => match[1] ?? "");
  return [...new Set(pins)].flatMap((path) => ["--pin", `${path}:1`]).concat("--exclude", DISPOSE);
}

function printed(index: number, count: number, args: readonly string[]): string[] {
  const out = execFileSync(
    process.execPath,
    [SCRIPT, "--shard", `${index}/${count}`, ...args, "--print"],
    {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  return out.split("\n").filter((line) => line !== "");
}

describe("CI shards by duration (row 010-35)", () => {
  const files = shard.discover();
  const timings = shard.readTimings();
  let walked: string[] | undefined;
  const readers = () => (walked ??= historyReaders(files));

  it("finds the test files Vitest's config includes", () => {
    // Vitest's own bin under this Node: a Squeal run may have no pnpm on its PATH.
    const vitestBin = join(ROOT, "node_modules/vitest/vitest.mjs");
    const listed = spawnSync(process.execPath, [vitestBin, "list", "--filesOnly", "--json"], {
      cwd: ROOT,
      encoding: "utf8",
      maxBuffer: 1 << 26,
    });
    expect(listed.status).toBe(0);
    const vitest = (JSON.parse(listed.stdout) as { file: string }[])
      .map((entry) => relative(ROOT, entry.file))
      .sort();
    expect(files).toEqual(vitest);
  });

  it("names each file by a path no other file's path contains, as Vitest's filter matches", () => {
    const lower = files.map((path) => path.toLowerCase());
    const shadowed = lower.filter((path) =>
      lower.some((other) => other !== path && other.includes(path)),
    );
    expect(shadowed).toEqual([]);
  });

  it.each([6, 3])("splits the workflow's %i shards with no file twice or missing", (count) => {
    const args = workflowArgs();
    const shards = Array.from({ length: count }, (_, at) => printed(at + 1, count, args));
    const all = shards.flat();
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual(files.filter((path) => path !== DISPOSE));
  });

  it("finds the history readers behind helpers: a release's tree, a released bundle, an old commit", () => {
    const found = readers();
    // Review 0.1.629, B1: `comparisons()` reads the last release through `lastRelease()`, and
    // `pluginAt(e, ref)` archives an old commit two helpers down.
    expect(found).toEqual(
      expect.arrayContaining([
        COMPARE,
        "test/keys/key-format.test.ts",
        "test/keys/validity/adapters.test.ts",
        "test/keys/validity/lock.test.ts",
        "test/keys/validity/pytest.test.ts",
        "test/keys/validity/reach.test.ts",
        "test/cli/group-pending-release.test.ts",
        "test/code/count/corpus.test.ts",
        "test/daemon/handover.test.ts",
        "test/e2e/codex-migration.test.ts",
        "test/e2e/run-triggers-control.test.ts",
      ]),
    );
    // The step-down kit offers `hasCommit`, but a file that calls none of its readers reads nothing.
    expect(found).not.toContain("test/daemon/step-down-keeps.test.ts");
    for (const path of NO_HISTORY.keys()) expect(found, `${path} is still found`).toContain(path);
  });

  it.each([6, 3])(
    "pins every history reader to shard 1 of %i, the shards still balanced",
    (count) => {
      const args = workflowArgs();
      const pins = shard.parseArgs(["--shard", `1/${count}`, ...args]).pins;
      const reading = readers().filter((path) => !NO_HISTORY.has(path));
      expect(reading.filter((path) => !pins.has(path))).toEqual([]);
      // A pin names a reader: an old pin that reads nothing any more only loads shard 1.
      expect([...pins.keys()].filter((path) => !reading.includes(path))).toEqual([]);
      const first = printed(1, count, args);
      expect([...pins.keys()].filter((path) => !first.includes(path))).toEqual([]);
      const kept = files.filter((path) => path !== DISPOSE);
      const loads = shard.partition(kept, count, timings, pins).map((each) => each.ms);
      expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(Math.max(...timings.values()));
    },
  );

  it("packs the measured files so the shards differ by less than the longest file", () => {
    const shards = shard.partition(files, 6, timings);
    const loads = shards.map((each) => each.ms);
    const longest = Math.max(...timings.values());
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(longest);
    // With `ci/test-timings.json` at row 010-35, the six shards were within a second of each other.
    expect(Math.max(...loads) - Math.min(...loads)).toBeLessThan(5_000);
  });

  it("orders each shard's files longest first", () => {
    const weight = (path: string) => timings.get(path) ?? shard.DEFAULT_MS;
    for (const each of shard.partition(files, 6, timings)) {
      const weights = each.files.map(weight);
      expect(weights).toEqual([...weights].sort((a, b) => b - a));
    }
  });

  it("places pins first, unmeasured files by their path's hash, the same every time", () => {
    const measured = new Map([
      ["a", 9_000],
      ["b", 5_000],
      ["c", 4_000],
    ]);
    const paths = ["a", "b", "c", "new-1", "new-2", "new-3"];
    const pins = new Map([["c", 2]]);
    const first = shard.partition(paths, 2, measured, pins);
    expect(first[1]?.files).toContain("c");
    expect(shard.partition([...paths].reverse(), 2, measured, pins)).toEqual(first);
    // An unmeasured file keeps its shard when other files come and go.
    const where = (shards: Shard[], path: string) =>
      shards.findIndex((each) => each.files.includes(path));
    const fewer = shard.partition(["new-2"], 2, new Map());
    expect(where(fewer, "new-2")).toBe(where(first, "new-2"));
    const total = first.reduce((sum, each) => sum + each.ms, 0);
    expect(total).toBe(18_000 + 3 * shard.DEFAULT_MS);
  });

  it("refuses a pin or an exclude that names no test file, and a shard out of range", () => {
    const run = (args: readonly string[]) =>
      spawnSync(process.execPath, [SCRIPT, ...args, "--print"], { cwd: ROOT, encoding: "utf8" });
    const missing = run(["--shard", "1/6", "--pin", "test/gone.test.ts:1"]);
    expect([missing.status, missing.stderr]).toEqual([2, expect.stringContaining("no such test")]);
    const excluded = run(["--shard", "1/6", "--exclude", "test/gone.test.ts"]);
    expect(excluded.status).toBe(2);
    expect(() => shard.parseArgs(["--shard", "7/6"])).toThrow(/1 <= i <= n/);
    expect(() => shard.parseArgs(["--shard", "1/6", "--pin", `${COMPARE}:7`])).toThrow(/no shard/);
  });

  it("runs an excluded file in no shard", () => {
    const shards = Array.from({ length: 6 }, (_, at) => printed(at + 1, 6, ["--exclude", COMPARE]));
    expect(shards.flat()).not.toContain(COMPARE);
    expect(shards.flat().length).toBe(files.length - 1);
  });
});
