// Row 015-111: how many test files reach each runner adapter, at all and through the scheduler
// test helpers, by a static walk of value imports. Read only; runs no test.
//
// Each tracked .ts file under src/ and test/ is transformed with esbuild as Vite does
// (`verbatimModuleSyntax` from tsconfig.json: `import type` drops, `import { type X }` stays as a
// bare import) and its imports, dynamic ones included, are read with es-module-lexer. Only relative
// specifiers are resolved; packages leave the graph. Test files are Vitest's: `*.test.ts` under
// test/ and src/, not under test/fixtures/.
//
// Usage: node runner-reach.mjs [repo] [helper...]
//   repo    a checkout (default: the current directory)
//   helper  repo-relative helper files (default: every test/scheduler/*.ts that is not a test
//           and is named in HELPERS below and exists)
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { join, posix } from "node:path";

const repo = process.argv[2] ?? process.cwd();
const req = createRequire(join(repo, "package.json"));
const esbuild = req("esbuild");
const lexer = req("es-module-lexer");
await lexer.init;

const ADAPTERS = ["src/runners/vitest/adapter.ts", "src/runners/node-test/adapter.ts"];
const HELPERS = [
  "test/scheduler/helpers.ts",
  "test/scheduler/cleanup.ts",
  "test/scheduler/repo.ts",
  "test/scheduler/recording-runner.ts",
  "test/scheduler/vitest-harness.ts",
  "test/scheduler/node-test-harness.ts",
];
const helpers =
  process.argv.length > 3 ? process.argv.slice(3) : HELPERS.filter((h) => existsSync(join(repo, h)));

const tracked = execFileSync("git", ["-C", repo, "ls-files", "src", "test"], { encoding: "utf8" })
  .split("\n")
  .filter((p) => p.endsWith(".ts") && !p.endsWith(".d.ts"));
const isFile = (p) => existsSync(join(repo, p)) && statSync(join(repo, p)).isFile();
function resolveSpec(from, spec) {
  if (!spec.startsWith(".")) return null;
  const base = posix.normalize(posix.join(posix.dirname(from), spec.split("?")[0]));
  const tries = [base, base.replace(/\.js$/, ".ts"), `${base}.ts`, `${base}/index.ts`];
  return tries.find(isFile) ?? null;
}

const edges = new Map();
function importsOf(path) {
  let out = edges.get(path);
  if (out !== undefined) return out;
  out = new Set();
  edges.set(path, out);
  if (!path.endsWith(".ts")) return out;
  const text = readFileSync(join(repo, path), "utf8");
  const { code } = esbuild.transformSync(text, {
    loader: "ts",
    format: "esm",
    tsconfigRaw: { compilerOptions: { verbatimModuleSyntax: true } },
  });
  const [imports] = lexer.parse(code);
  for (const im of imports) {
    // es-module-lexer 1.x names the specifier `n`, 3.x `specifier`; a computed dynamic one has neither.
    const spec = im.n ?? im.specifier;
    if (typeof spec !== "string") continue;
    const target = resolveSpec(path, spec);
    if (target !== null) out.add(target);
  }
  return out;
}
function closure(start) {
  const seen = new Set([start]);
  const stack = [start];
  while (stack.length > 0) for (const next of importsOf(stack.pop())) {
    if (!seen.has(next)) {
      seen.add(next);
      stack.push(next);
    }
  }
  return seen;
}

const tests = tracked.filter((p) => p.endsWith(".test.ts") && !p.startsWith("test/fixtures/"));
const closures = new Map(tests.map((t) => [t, closure(t)]));
const helperClosures = new Map(helpers.map((h) => [h, closure(h)]));
const result = { helpers, tests: tests.length, adapters: {} };
for (const adapter of ADAPTERS) {
  const viaHelpers = new Set();
  const byHelper = {};
  for (const h of helpers) {
    if (!helperClosures.get(h).has(adapter)) continue;
    const reaching = tests.filter((t) => closures.get(t).has(h));
    byHelper[h] = reaching.length;
    for (const t of reaching) viaHelpers.add(t);
  }
  const atAll = tests.filter((t) => closures.get(t).has(adapter)).length;
  result.adapters[adapter] = { atAll, throughHelpers: viaHelpers.size, byHelper };
}
// Test files that reach any helper, and those that reach a helper but no runner adapter through one.
const reachHelpers = tests.filter((t) => helpers.some((h) => closures.get(t).has(h)));
result.reachHelpers = reachHelpers.length;
console.log(JSON.stringify(result, null, 2));
