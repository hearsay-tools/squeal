// Throwaway probe (row 011-415). Builds every test file's import closure two
// ways on one repository and compares them:
//   vite: Squeal's own `importClosure` (Vite's transform graph), as the daemon does;
//   fast: a parser per file plus Vite's own resolver (`pluginContainer.resolveId`).
// Parsers: `oxc-strip` (rolldown's transformSync, the function Vite's oxc plugin
// calls, then es-module-lexer on its output), `oxc-parse` (rolldown's parseSync
// AST plus an elision rule), `babel` (@babel/parser AST plus the same rule).
//
// Usage: tsx probe.ts <root> <out-dir> [--adapter] [--related <n>]
// Writes <out-dir>/summary.json and <out-dir>/diffs.json. Never runs a test.
import { existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { cpus, loadavg } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import type { TestProject, TestSpecification, Vitest } from "vitest/node";
import { WorktreePaths } from "../../../../../../src/core/fs/worktree-paths.ts";
import type { AbsolutePath } from "../../../../../../src/core/types/common.ts";
import {
  builtinOf,
  type ImportClosure,
  importClosure,
  packageName,
} from "../../../../../../src/runners/vitest/graph.ts";
import { loadVitest } from "../../../../../../src/runners/vitest/load.ts";
import { sourceLoads } from "../../../../../../src/runners/vitest/loads.ts";

const root = realpathSync(process.argv[2] ?? ".") as AbsolutePath;
const outDir = resolve(process.argv[3] ?? "out");
const withAdapter = process.argv.includes("--adapter");
const relatedIdx = process.argv.indexOf("--related");
const relatedCount = relatedIdx > 0 ? Number(process.argv[relatedIdx + 1]) : 0;
mkdirSync(outDir, { recursive: true });
const paths = new WorktreePaths(root);
const summary: Record<string, unknown> = { root: "<root>", cpus: cpus().length, cpu: cpus()[0]?.model };
const log = (...a: unknown[]) => console.error(new Date().toISOString().slice(11, 19), ...a);

// ---------- timing ----------
interface Timed { wallMs: number; cpuMs: number; load1: number }
async function timed<T>(fn: () => Promise<T> | T): Promise<[T, Timed]> {
  const load1 = loadavg()[0] ?? 0;
  const c0 = process.cpuUsage();
  const t0 = performance.now();
  const value = await fn();
  const wallMs = performance.now() - t0;
  const c = process.cpuUsage(c0);
  return [value, { wallMs: round(wallMs), cpuMs: round((c.user + c.system) / 1000), load1 }];
}
const round = (n: number) => Math.round(n * 10) / 10;

// ---------- Vitest instance, as the adapter opens it (no reporter, no coverage) ----------
const node = await loadVitest(root);
async function open(): Promise<Vitest> {
  const vitest = await node.createVitest("test", {
    root,
    watch: false,
    reporters: [],
    update: "none",
    fsModuleCache: false,
    coverage: { enabled: false },
    cache: false,
  } as never);
  await vitest.standalone();
  return vitest;
}
const supported = (specs: readonly TestSpecification[]) =>
  specs.filter((s) => s.pool !== "typescript" && !s.project.config.browser?.enabled);
const specKey = (s: TestSpecification) => `${s.project.name}\0${s.moduleId}`;

// ---------- the closure record compared ----------
interface Record_ {
  files: string[]; // project files, relative, sorted
  missing: string[];
  packages: string[];
  builtins: string[];
}
function packageOfPath(p: string): string | null {
  const i = p.lastIndexOf(`${sep}node_modules${sep}`);
  if (i < 0) return null;
  const rest = p.slice(i + 14).split(sep);
  return rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : (rest[0] ?? null);
}
function recordOf(c: ImportClosure): Record_ {
  const files: string[] = [];
  const packages = new Set<string>();
  for (const f of c.files) {
    if (paths.isProjectFile(f)) files.push(paths.toRelative(f) ?? f);
    else {
      const pkg = packageOfPath(f);
      packages.add(pkg ?? `<outside>${f}`);
    }
  }
  for (const names of c.bare.values()) for (const n of names) packages.add(n.replace(/\/package\.json$/, ""));
  const rel = (p: string) => paths.toRelative(p as AbsolutePath) ?? p;
  return {
    files: files.sort(),
    missing: [...c.missing].map(rel).sort(),
    packages: [...packages].sort(),
    builtins: [...c.builtins].sort(),
  };
}

// ---------- fast graph ----------
type Parsed = { static: string[]; dynamic: string[] };
type Parser = (file: string, source: string) => Parsed;

// The Vite the project's Vitest loads (a copy's parent directories may hold another).
const viteRequire = createRequire(
  createRequire(createRequire(join(root, "package.json")).resolve("vitest")).resolve("vite"),
);
const rolldownUtils = await import(pathToFileURL(viteRequire.resolve("rolldown/utils")).href);
// es-module-lexer 3 (it reads TypeScript and flags type-only statements), from Squeal's own tree.
const squealViteRequire = createRequire(createRequire(createRequire(import.meta.url).resolve("vitest")).resolve("vite"));
const lexer = await import(pathToFileURL(squealViteRequire.resolve("es-module-lexer")).href);
await lexer.init;
const babel = createRequire(import.meta.url)("@babel/parser");
/** A package's version from the manifest above its resolved entry (some export no `./package.json`). */
function versionOf(req: NodeRequire, name: string): string {
  let dir = dirname(req.resolve(name));
  while (dir !== dirname(dir)) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const json = JSON.parse(readFileSync(manifest, "utf8"));
      if (json.name === name) return json.version;
    }
    dir = dirname(dir);
  }
  return "?";
}
const rootRequire = createRequire(join(root, "package.json"));
summary.versions = {
  vitest: versionOf(rootRequire, "vitest"),
  vite: versionOf(viteRequire, "vite"),
  rolldown: versionOf(viteRequire, "rolldown"),
  esModuleLexer: versionOf(squealViteRequire, "es-module-lexer"),
  babelParser: versionOf(createRequire(import.meta.url), "@babel/parser"),
};

const OXC_FILTER = /\.(m?ts|[jt]sx)$/;
const langOf = (f: string) =>
  /\.[mc]?tsx?$/.test(f) ? (f.endsWith("x") ? "tsx" : "ts") : f.endsWith(".jsx") ? "jsx" : "js";

function makeOxcStrip(oxcOptions: Record<string, unknown>): Parser {
  const cache = new rolldownUtils.TsconfigCache();
  return (file, source) => {
    let code = source;
    if (OXC_FILTER.test(file)) {
      const r = rolldownUtils.transformSync(file, source, { ...oxcOptions, lang: langOf(file), sourcemap: false }, cache);
      code = r.code;
    }
    return lexed(code, false);
  };
}

/** es-module-lexer 3's imports: static and re-exports apart from literal dynamic ones. */
function lexed(code: string, dropTypeOnly: boolean): Parsed {
  const out: Parsed = { static: [], dynamic: [] };
  let imports: Array<{ type: string; specifier?: string; typeOnly?: boolean; probablyTypeOnly?: boolean; glob?: boolean }>;
  try {
    [imports] = lexer.parse(code);
  } catch {
    return out;
  }
  for (const i of imports) {
    // A template with expressions comes back as a glob (`./*`); Vite keeps only literal ones.
    if (i.specifier === undefined || i.type === "import-meta" || i.glob) continue;
    if (dropTypeOnly && (i.typeOnly || i.probablyTypeOnly)) continue;
    if (i.type === "dynamic") out.dynamic.push(i.specifier);
    else out.static.push(i.specifier);
  }
  return out;
}

/** es-module-lexer 3 on the source itself: drops `import type`/`export type`; cannot see usage. */
const lexerTs: Parser = (_file, source) => lexed(source, true);

/** verbatimModuleSyntax as Vite's transform resolves it for a file's directory: asked of the transform itself. */
function makeVmsOf(): (file: string) => boolean {
  const cache = new rolldownUtils.TsconfigCache();
  const byDir = new Map<string, boolean>();
  return (file) => {
    const dir = dirname(file);
    let v = byDir.get(dir);
    if (v === undefined) {
      const r = rolldownUtils.transformSync(join(dir, "__probe__.ts"), `import { A } from "./x"; export const y = 1;`, { lang: "ts", sourcemap: false }, cache);
      v = r.code.includes("./x");
      byDir.set(dir, v);
    }
    return v;
  };
}

// Value-position identifier names over an ESTree+TS AST (oxc's, or Babel's with `estree`).
const VALUE_TS = new Set([
  "TSAsExpression", "TSSatisfiesExpression", "TSNonNullExpression", "TSTypeAssertion",
  "TSInstantiationExpression", "TSParameterProperty", "TSEnumDeclaration", "TSEnumBody",
  "TSEnumMember", "TSModuleDeclaration", "TSModuleBlock", "TSExportAssignment",
  "TSImportEqualsDeclaration", "TSExternalModuleReference", "TSQualifiedName",
]);
const TYPE_KEYS = new Set([
  "typeAnnotation", "typeArguments", "typeParameters", "returnType", "superTypeArguments",
  "superTypeParameters", "implements", "loc", "range", "extra", "start", "end",
]);
function valueNames(program: unknown): Set<string> {
  const names = new Set<string>();
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const n = stack.pop() as Record<string, unknown> | null;
    if (!n || typeof n !== "object") continue;
    const type = n.type as string | undefined;
    if (typeof type !== "string") continue;
    if (type.startsWith("TS") && !VALUE_TS.has(type)) continue;
    if (type === "ImportDeclaration") continue;
    if (n.declare === true) continue;
    if ((type === "ExportNamedDeclaration" || type === "ExportSpecifier") && n.exportKind === "type") continue;
    if (type === "TSModuleDeclaration" && n.kind !== "namespace" && n.kind !== "module") continue;
    if (type === "Identifier" || type === "JSXIdentifier") names.add(n.name as string);
    for (const key in n) {
      if (TYPE_KEYS.has(key)) continue;
      // Non-computed property names are not references.
      if (key === "property" && type === "MemberExpression" && !n.computed) continue;
      if (key === "key" && !n.computed && !n.shorthand && (type === "Property" || type === "PropertyDefinition" || type === "MethodDefinition" || type === "ObjectProperty" || type === "ClassProperty" || type === "ClassMethod" || type === "AccessorProperty")) continue;
      if (key === "label") continue;
      if (key === "exported" && type === "ExportSpecifier") continue;
      const v = n[key];
      if (Array.isArray(v)) for (const x of v) stack.push(x);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  return names;
}

function stringOf(node: Record<string, unknown> | null | undefined): string | null {
  if (!node) return null;
  if ((node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string") return node.value;
  return null;
}

/** Vite's elision as measured by elision.mjs, applied to an ESTree+TS program. */
function elide(program: { body: Array<Record<string, unknown>> }, vms: boolean, jsxRuntime: string | null = null): Parsed {
  const out: Parsed = { static: [], dynamic: [] };
  let jsx = false;
  let used: Set<string> | null = null;
  for (const s of program.body) {
    const src = stringOf(s.source as never);
    if (s.type === "ImportDeclaration" && src !== null) {
      if (s.importKind === "type") continue;
      const specs = (s.specifiers as Array<Record<string, unknown>>) ?? [];
      if (specs.length === 0) { out.static.push(src); continue; }
      const values = specs.filter((x) => x.importKind !== "type");
      if (vms) { out.static.push(src); continue; } // kept, as `import "x"` when all are inline types
      if (values.length === 0) continue;
      used ??= valueNames(program);
      if (values.some((x) => used!.has((x.local as { name: string }).name))) out.static.push(src);
    } else if (s.type === "ExportNamedDeclaration" && src !== null) {
      if (s.exportKind === "type") continue;
      const specs = (s.specifiers as Array<Record<string, unknown>>) ?? [];
      if (specs.length > 0 && specs.every((x) => x.exportKind === "type")) continue;
      out.static.push(src);
    } else if (s.type === "ExportAllDeclaration" && src !== null) {
      if (s.exportKind === "type") continue;
      out.static.push(src);
    }
  }
  // Literal `import()` anywhere.
  const stack: unknown[] = [program];
  while (stack.length > 0) {
    const n = stack.pop() as Record<string, unknown> | null;
    if (!n || typeof n !== "object") continue;
    if (n.type === "ImportExpression") {
      const v = stringOf(n.source as never);
      if (v !== null) out.dynamic.push(v);
    }
    if (n.type === "JSXElement" || n.type === "JSXFragment") jsx = true;
    for (const key in n) {
      if (key === "loc" || key === "range" || key === "extra") continue;
      const v = n[key];
      if (Array.isArray(v)) for (const x of v) stack.push(x);
      else if (v && typeof v === "object") stack.push(v);
    }
  }
  // The automatic JSX runtime: the transform adds its import to a file with JSX.
  if (jsx && jsxRuntime !== null) out.static.push(jsxRuntime);
  return out;
}

/** The import the project's oxc options make a JSX file gain, or null (classic runtime). */
function jsxRuntimeOf(oxc: Record<string, unknown>): string | null {
  const jsx = oxc.jsx as { runtime?: string; importSource?: string } | string | undefined;
  if (jsx === "preserve" || (typeof jsx === "object" && jsx.runtime === "classic")) return null;
  const source = typeof jsx === "object" && jsx.importSource ? jsx.importSource : "react";
  return `${source}/jsx-runtime`;
}

function makeOxcParse(vmsOf: (f: string) => boolean, jsxRuntime: string | null): Parser {
  return (file, source) => {
    const r = rolldownUtils.parseSync(file, source, { lang: langOf(file), sourceType: "module", astType: /\.[mc]?tsx?$/.test(file) ? "ts" : "js" });
    return elide(r.program, /\.[mc]?tsx?$/.test(file) ? vmsOf(file) : true, OXC_FILTER.test(file) ? jsxRuntime : null);
  };
}
function makeBabel(vmsOf: (f: string) => boolean, jsxRuntime: string | null): Parser {
  return (file, source) => {
    const ts = /\.[mc]?tsx?$/.test(file);
    const jsx = file.endsWith("x") || !ts;
    let ast: { program: { body: Array<Record<string, unknown>> } };
    try {
      ast = babel.parse(source, {
        sourceType: "module", errorRecovery: true, createImportExpressions: true,
        plugins: ["estree", ...(ts ? [["typescript", {}]] : []), ...(jsx ? ["jsx"] : []), "decorators-legacy", "importAttributes"],
      });
    } catch {
      return { static: [], dynamic: [] };
    }
    return elide(ast.program, ts ? vmsOf(file) : true, OXC_FILTER.test(file) ? jsxRuntime : null);
  };
}

/** Verbatim copy of graph.ts `requireTarget` (not exported): Node's relative `require` lookup. */
const REQUIRE_EXTENSIONS = [".js", ".json", ".node"];
function requireTarget(importer: string, specifier: string): string | null {
  const path = resolve(dirname(importer), specifier);
  const kind = (c: string) => statSync(c, { throwIfNoEntry: false });
  if (kind(path)?.isFile()) return path;
  for (const ext of REQUIRE_EXTENSIONS) if (kind(`${path}${ext}`)?.isFile()) return `${path}${ext}`;
  if (!kind(path)?.isDirectory()) return path;
  if (existsSync(join(path, "package.json"))) return null;
  for (const ext of REQUIRE_EXTENSIONS) {
    const index = join(path, `index${ext}`);
    if (kind(index)?.isFile()) return index;
  }
  return null;
}
const isRelative = (s: string) => s.startsWith("./") || s.startsWith("../") || s === "." || s === "..";

interface Hop { targets: string[]; bare: string[]; builtins: string[] }
interface FastState {
  parsed: Map<string, Parsed & { requires: string[]; unnamed: boolean }>;
  resolved: Map<string, { kind: "file" | "bare" | "builtin" | "none"; value: string }>;
  hops: Map<string, Hop>;
  parseMs: number;
  resolveMs: number;
  resolveCalls: number;
  files: number;
}
const newState = (): FastState => ({ parsed: new Map(), resolved: new Map(), hops: new Map(), parseMs: 0, resolveMs: 0, resolveCalls: 0, files: 0 });

/** One specifier as importClosure would record it, through Vite's resolver. */
async function resolveSpec(project: TestProject, st: FastState, spec: string, importer: string) {
  const key = `${dirname(importer)}\0${spec}`;
  const held = st.resolved.get(key);
  if (held) return held;
  const t0 = performance.now();
  let out: { kind: "file" | "bare" | "builtin" | "none"; value: string };
  const builtin = builtinOf(spec);
  if (builtin !== null) out = { kind: "builtin", value: builtin };
  else {
    const env = project.vite.environments.ssr!;
    let r: { id: string; external?: unknown } | null = null;
    try { r = (await env.pluginContainer.resolveId(spec, importer)) as never; } catch { r = null; }
    st.resolveCalls++;
    if (r === null) {
      const clean = spec.split("?")[0] ?? spec;
      if (clean.startsWith("./") || clean.startsWith("../")) out = { kind: "file", value: resolve(dirname(importer), clean) };
      else {
        const name = packageName(spec);
        out = name === null ? { kind: "none", value: spec } : { kind: "bare", value: name };
      }
    } else if (r.id.startsWith("\0") || (r.id.includes(":") && !r.id.startsWith("/"))) {
      out = { kind: "none", value: r.id };
    } else {
      const p = r.id.split("?")[0] ?? r.id;
      const pkg = packageName(spec);
      if (p.includes(`${sep}node_modules${sep}`) && pkg !== null) out = { kind: "bare", value: pkg };
      else out = { kind: "file", value: p };
    }
  }
  st.resolveMs += performance.now() - t0;
  st.resolved.set(key, out);
  return out;
}

async function fastHop(project: TestProject, st: FastState, parserOf: (p: TestProject) => Parser, file: string): Promise<Hop> {
  const parser = parserOf(project);
  const held = st.hops.get(file);
  if (held) return held;
  let p = st.parsed.get(file);
  if (!p) {
    const t0 = performance.now();
    let source: string | null = null;
    try { source = readFileSync(file, "utf8"); } catch { /* gone */ }
    if (source === null) p = { static: [], dynamic: [], requires: [], unnamed: true };
    else {
      let parsed: Parsed;
      try { parsed = parser(file, source); } catch { parsed = { static: [], dynamic: [] }; }
      const loads = sourceLoads(source);
      p = { ...parsed, requires: [...loads.requires], unnamed: loads.unnamed };
    }
    st.parseMs += performance.now() - t0;
    st.files++;
    st.parsed.set(file, p);
  }
  const hop: Hop = { targets: [], bare: [], builtins: [] };
  for (const spec of [...p.static, ...p.dynamic]) {
    const r = await resolveSpec(project, st, spec, file);
    if (r.kind === "file") hop.targets.push(r.value);
    else if (r.kind === "bare") hop.bare.push(r.value);
    else if (r.kind === "builtin") hop.builtins.push(r.value);
  }
  for (const spec of p.requires) {
    if (isRelative(spec)) {
      const t = requireTarget(file, spec);
      if (t === null) hop.builtins.push("module");
      else hop.targets.push(t);
    } else if (builtinOf(spec) !== null) hop.builtins.push(builtinOf(spec)!);
    else if (packageName(spec) !== null) hop.bare.push(packageName(spec)!);
    else hop.builtins.push("module");
  }
  if (p.unnamed) hop.builtins.push("module");
  st.hops.set(file, hop);
  return hop;
}

async function fastClosure(project: TestProject, st: FastState, parser: (p: TestProject) => Parser, entry: string) {
  const files = new Set<string>();
  const missing = new Set<string>();
  const bare = new Map<string, Set<string>>();
  const builtins = new Set<string>();
  const edges = new Map<string, string[]>();
  const queue = [entry];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (files.has(file) || missing.has(file)) continue;
    if (!existsSync(file)) { missing.add(file); continue; }
    files.add(file);
    if (file.includes("node_modules")) continue;
    const hop = await fastHop(project, st, parser, file);
    if (hop.bare.length > 0) bare.set(file, new Set(hop.bare));
    for (const b of hop.builtins) builtins.add(b);
    edges.set(file, hop.targets);
    queue.push(...hop.targets);
  }
  return { closure: { files, missing, bare, builtins, rooted: new Set(), root } as unknown as ImportClosure, edges };
}

// ---------- compare ----------
function diff(a: string[], b: string[]) {
  const sa = new Set(a), sb = new Set(b);
  return { onlyVite: a.filter((x) => !sb.has(x)), onlyFast: b.filter((x) => !sa.has(x)) };
}

// ================= run =================
log("open instance for the vite closures");
const v1 = await open();
const specs = supported(await v1.globTestSpecifications());
summary.testFiles = specs.length;
summary.projects = [...new Set(specs.map((s) => s.project.name))];
log(`${specs.length} test files`);

const viteRecords = new Map<string, Record_>();
const viteEdges = new Map<string, Map<string, string[]>>();
async function viteRound(save: boolean) {
  for (const s of specs) {
    const c = await importClosure(s.project, [s.moduleId as AbsolutePath]);
    if (save) {
      viteRecords.set(specKey(s), recordOf(c));
      const e = new Map<string, string[]>();
      for (const [f, ed] of c.edges ?? []) e.set(f, [...ed.static, ...ed.dynamic]);
      viteEdges.set(specKey(s), e);
    }
  }
}
const [, viteCold] = await timed(() => viteRound(true));
log("vite cold", viteCold);
const [, viteWarm] = await timed(() => viteRound(false));
log("vite warm", viteWarm);
summary.vite = { cold: viteCold, warm: viteWarm, coldPerFileMs: round(viteCold.wallMs / specs.length), warmPerFileMs: round(viteWarm.wallMs / specs.length) };

// Related walk timing on the same instance (Vitest's filterTestsBySource), and selection parity.
const { relatedSpecifications } = await import("../../../../../../src/runners/vitest/related.ts");
const sourceFiles = [...new Set([...viteRecords.values()].flatMap((r) => r.files))]
  .filter((f) => !specs.some((s) => paths.toRelative(s.moduleId as AbsolutePath) === f))
  .sort();
const sample: string[] = [];
for (let i = 0; i < relatedCount && sourceFiles.length > 0; i++) {
  sample.push(sourceFiles[Math.floor(((i + 0.5) / relatedCount) * sourceFiles.length)]!);
}
const relatedResults: Record<string, string[]> = {};
const relatedTimes: Timed[] = [];
for (const f of sample) {
  const [hits, t] = await timed(() => relatedSpecifications(v1, specs, [paths.toAbsolute(f as never)]));
  relatedResults[f] = hits.map((h) => paths.toRelative(h.moduleId as AbsolutePath) ?? h.moduleId).sort();
  relatedTimes.push(t);
}
summary.related = { sample: sample.length, times: relatedTimes };
await v1.close();

// Fast graphs: one fresh instance (fresh resolver) for the first parser's cold build.
log("open instance for the fast graphs");
const v2 = await open();
const specs2 = supported(await v2.globTestSpecifications());
/** The project's oxc options as Vite's oxc plugin passes them on. */
const oxcOptionsOf = (project: TestProject) => {
  const o = { ...((project.vite.config as { oxc?: Record<string, unknown> }).oxc ?? {}) };
  for (const k of ["jsxInject", "include", "exclude", "jsxRefreshInclude", "jsxRefreshExclude"]) delete o[k];
  return o;
};
const vmsOf = makeVmsOf();
/** One parser per Vitest project, made from that project's oxc options. */
const perProject = (make: (oxc: Record<string, unknown>) => Parser): ((p: TestProject) => Parser) => {
  const held = new Map<string, Parser>();
  return (p) => {
    let parser = held.get(p.name);
    if (!parser) held.set(p.name, (parser = make(oxcOptionsOf(p))));
    return parser;
  };
};
const parsers: Array<[string, (p: TestProject) => Parser]> = [
  ["oxc-strip", perProject((oxc) => makeOxcStrip(oxc))],
  ["oxc-parse", perProject((oxc) => makeOxcParse(vmsOf, jsxRuntimeOf(oxc)))],
  ["babel", perProject((oxc) => makeBabel(vmsOf, jsxRuntimeOf(oxc)))],
  ["lexer-ts", () => lexerTs],
];
const fastSummary: Record<string, unknown> = {};
const allDiffs: Record<string, unknown> = {};
let sharedResolved: FastState["resolved"] | null = null;
for (const [name, parser] of parsers) {
  const st = newState();
  if (sharedResolved) st.resolved = sharedResolved; // later parsers reuse resolutions: parse cost isolated
  const records = new Map<string, Record_>();
  const edgesBy = new Map<string, Map<string, string[]>>();
  const [, cold] = await timed(async () => {
    for (const s of specs2) {
      const { closure, edges } = await fastClosure(s.project, st, parser, s.moduleId);
      records.set(specKey(s), recordOf(closure));
      edgesBy.set(specKey(s), edges);
    }
  });
  const coldParse = { parseMs: round(st.parseMs), resolveMs: round(st.resolveMs), resolveCalls: st.resolveCalls, filesParsed: st.files };
  // Warm: graph held, closures walked again (no parse, no resolve).
  const [, warm] = await timed(async () => {
    for (const s of specs2) await fastClosure(s.project, st, parser, s.moduleId);
  });
  // Re-parse every held file once (an edit of every file): parse cost alone.
  const files = [...st.parsed.keys()];
  const anyParser = parser(specs2[0]!.project);
  const [, reparse] = await timed(() => {
    for (const f of files) anyParser(f, readFileSync(f, "utf8"));
  });
  // Reverse walk for the related sample.
  const [relFast, relT] = await timed(() => {
    const out: Record<string, string[]> = {};
    for (const f of sample) {
      out[f] = specs2.filter((s) => records.get(specKey(s))!.files.includes(f)).map((s) => paths.toRelative(s.moduleId as AbsolutePath)!).sort();
    }
    return out;
  });
  sharedResolved = st.resolved;
  // Compare.
  const perTest: Record<string, unknown> = {};
  const counts = { files: 0, missing: 0, packages: 0, builtins: 0, any: 0 };
  const edgeDiffs = new Map<string, { file: string; target: string; side: string; tests: number }>();
  for (const s of specs2) {
    const k = specKey(s);
    const a = viteRecords.get(k), b = records.get(k);
    if (!a || !b) continue;
    const d = { files: diff(a.files, b.files), missing: diff(a.missing, b.missing), packages: diff(a.packages, b.packages), builtins: diff(a.builtins, b.builtins) };
    let differs = false;
    for (const [cat, dd] of Object.entries(d)) {
      if (dd.onlyVite.length + dd.onlyFast.length > 0) { counts[cat as keyof typeof counts]++; differs = true; }
    }
    if (differs) {
      counts.any++;
      perTest[paths.toRelative(s.moduleId as AbsolutePath) ?? s.moduleId] = d;
      // Per-file edge differences, among files both walked.
      const ve = viteEdges.get(k)!, fe = edgesBy.get(k)!;
      for (const [f, vt] of ve) {
        const ft = fe.get(f);
        if (!ft) continue;
        const ed = diff([...new Set(vt)], [...new Set(ft)]);
        for (const [side, list] of [["onlyVite", ed.onlyVite], ["onlyFast", ed.onlyFast]] as const) {
          for (const t of list) {
            const key = `${f}\0${t}\0${side}`;
            const cur = edgeDiffs.get(key) ?? { file: paths.toRelative(f as AbsolutePath) ?? f, target: paths.toRelative(t as AbsolutePath) ?? t, side, tests: 0 };
            cur.tests++;
            edgeDiffs.set(key, cur);
          }
        }
      }
    }
  }
  const relatedParity = sample.filter((f) => JSON.stringify(relFast[f]) !== JSON.stringify(relatedResults[f]));
  fastSummary[name] = {
    cold, coldParse, warm, reparse: { ...reparse, files: files.length, perFileMs: round(reparse.wallMs / files.length) },
    relatedReverse: relT, relatedDiffer: relatedParity,
    differ: counts,
  };
  allDiffs[name] = { counts, edges: [...edgeDiffs.values()].sort((x, y) => y.tests - x.tests), perTest };
  log(name, JSON.stringify(fastSummary[name]));
}
summary.fast = fastSummary;
await v2.close();

// Today's whole closure loop through the real adapter (cold and warm), and `affected`.
if (withAdapter) {
  const { createVitestAdapter } = await import("../../../../../../src/runners/vitest/index.ts");
  const adapter = await createVitestAdapter({ root, maxWorkers: 1, cache: false } as never);
  const refs = await adapter.testFiles();
  const round_ = async () => { for (const r of refs) await adapter.closure(r); };
  const [, aCold] = await timed(round_);
  const [, aWarm] = await timed(round_);
  const affectedTimes: Timed[] = [];
  for (const f of sample.slice(0, 3)) {
    const [, t] = await timed(() => adapter.affected([f as never]));
    affectedTimes.push(t);
  }
  summary.adapter = { testFiles: refs.length, cold: aCold, warm: aWarm, coldPerFileMs: round(aCold.wallMs / refs.length), warmPerFileMs: round(aWarm.wallMs / refs.length), affected: affectedTimes };
  log("adapter", JSON.stringify(summary.adapter));
  await (adapter as unknown as { close(): Promise<void> }).close?.();
}

writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
writeFileSync(join(outDir, "diffs.json"), `${JSON.stringify(allDiffs, null, 1)}\n`);
log("done");
process.exit(0);
