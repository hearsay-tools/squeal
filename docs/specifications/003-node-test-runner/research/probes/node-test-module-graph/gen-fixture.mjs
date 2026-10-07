// THROWAWAY probe. Generates a fixture shaped like the reference project:
// a root with `workspaces: ["packages/*"]`, `scripts/test-git-env.mjs` preload,
// `packages/core` (tests under test/unit and test/e2e, run as
// `node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts`),
// and `packages/util` symlinked into `node_modules/@ref/util`.
//
// usage: node gen-fixture.mjs <outDir> <coreModules> <utilModules> <unitTests>
//   small: node gen-fixture.mjs fixtures/ref 6 4 4
//   large: node gen-fixture.mjs fixtures/big 700 300 200
import { mkdirSync, writeFileSync, rmSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";

const [out, coreN = "6", utilN = "4", testN = "4"] = process.argv.slice(2);
const CORE = Number(coreN), UTIL = Number(utilN), TESTS = Number(testN);
rmSync(out, { recursive: true, force: true });
const w = (p, s) => { mkdirSync(dirname(join(out, p)), { recursive: true }); writeFileSync(join(out, p), s); };
let seed = 42;
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const pad = (i) => String(i).padStart(3, "0");

w("package.json", JSON.stringify({ name: "ref-root", private: true, type: "module", workspaces: ["packages/*"] }, null, 2));
w("scripts/test-git-env.mjs", `import { gitEnv } from "./lib/git-env-helper.mjs";\nObject.assign(process.env, gitEnv());\n`);
w("scripts/lib/git-env-helper.mjs", `export const gitEnv = () => ({ GIT_AUTHOR_NAME: "probe", GIT_CONFIG_NOSYSTEM: "1" });\n`);

// packages/util: exports map, own barrel
w("packages/util/package.json", JSON.stringify({
  name: "@ref/util", type: "module",
  exports: { ".": "./src/index.ts", "./str": "./src/str.ts", "./*": "./src/*.ts" },
}, null, 2));
w("packages/util/src/str.ts", `export const upper = (s: string): string => s.toUpperCase();\n`);
for (let i = 0; i < UTIL; i++) {
  const deps = i === 0 ? [] : [rnd(i), ...(i > 1 ? [Math.max(0, i - 1 - rnd(20))] : [])];
  const uniq = [...new Set(deps)];
  w(`packages/util/src/u${pad(i)}.ts`,
    uniq.map((d) => `import { u${pad(d)} } from "./u${pad(d)}.js";`).join("\n") +
    // each value is computed once at module init: calling dependencies at call time is exponential
    `\nconst v = (${uniq.map((d) => `u${pad(d)}()`).join(" + ") || "0"}) % 997 + 1;\nexport const u${pad(i)} = (): number => v;\n`);
}
w("packages/util/src/index.ts",
  Array.from({ length: Math.min(UTIL, 10) }, (_, i) => `export { u${pad(i)} } from "./u${pad(i)}.js";`).join("\n") +
  `\nexport { upper } from "./str.js";\n`);

// packages/core: imports map, tsconfig paths, hand-written edge cases
w("packages/core/package.json", JSON.stringify({
  name: "@ref/core", type: "module",
  imports: { "#internal/*": "./src/*.ts" },
  scripts: {
    "test:unit": "node --import ../../scripts/test-git-env.mjs --import tsx --test test/unit/*.test.ts",
    "test:package": "node --import ../../scripts/test-git-env.mjs --import tsx --test test/e2e/*.test.ts",
  },
  dependencies: { "@ref/util": "*" },
}, null, 2));
w("packages/core/tsconfig.json", JSON.stringify({
  compilerOptions: { target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", strict: true,
    allowImportingTsExtensions: true, noEmit: true, paths: { "~/*": ["./src/*"] } },
}, null, 2));

const edge = {
  // one of each specifier form the brief names
  "src/edge/js-means-ts.ts": `import { b } from "./extless-target.js";\nexport const a = () => b() + 1;\n`,
  "src/edge/extless-target.ts": `import { c } from "./paths-target";\nexport const b = () => c() + 1;\n`,
  "src/edge/paths-target.ts": `import { d } from "~/edge/dir";\nexport const c = () => d() + 1;\n`,
  "src/edge/dir/index.ts": `import { e } from "#internal/edge/imports-target";\nexport const d = () => e() + 1;\n`,
  "src/edge/imports-target.ts": `import { upper } from "@ref/util/str";\nimport { u000 } from "@ref/util";\nexport { f } from "./reexported.js";\nexport const e = () => upper("x").length + u000();\n`,
  "src/edge/reexported.ts": `export const f = () => 6;\n`,
  "src/edge/types.ts": `export interface T { x: number }\n`,
  "src/edge/type-only.ts": `import type { T } from "./types.js";\nexport const g = (t: T) => t.x;\n`,
  "src/edge/dyn-literal.ts": `export const h = async () => (await import("./dyn-target.js")).dt();\n`,
  "src/edge/dyn-target.ts": `export const dt = () => 8;\n`,
  "src/edge/computed.ts": `export const plugin = async (name: string) => (await import(\`./plugins/\${name}.ts\`)).run();\n`,
  "src/edge/plugins/alpha.ts": `export const run = () => "alpha";\n`,
  "src/edge/computed-var.ts": `export const viaVar = async () => { const p = ["./var", "target.js"].join("-"); return (await import(p)).vt(); };\n`,
  "src/edge/var-target.ts": `export const vt = () => 11;\n`,
  "src/edge/shape.ts": `export interface Shape { w: number }\n`,
  "src/edge/type-implicit.ts": `import { Shape } from "./shape.js";\nexport const area = (s: Shape) => s.w;\n`,
  "src/edge/cjs-user.ts": `import { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nexport const legacy = (): number => require("./legacy.cjs").value;\n`,
  "src/edge/legacy.cjs": `const dep = require("./legacy-dep.cjs");\nmodule.exports = { value: dep.n + 1 };\n`,
  "src/edge/legacy-dep.cjs": `module.exports = { n: 9 };\n`,
  "src/edge/json-user.ts": `import data from "./data.json" with { type: "json" };\nexport const j = () => data.n;\n`,
  "src/edge/data.json": `{ "n": 10 }\n`,
  "src/edge/fs-reader.ts": `import { readFileSync } from "node:fs";\nexport const fsRead = () => readFileSync(new URL("./fixture.txt", import.meta.url), "utf8").trim();\n`,
  "src/edge/fixture.txt": `from-disk\n`,
  "src/edge/spawner.ts": `import { execFileSync } from "node:child_process";\nimport { fileURLToPath } from "node:url";\nexport const spawned = () => execFileSync(process.execPath, [fileURLToPath(new URL("./child-script.mjs", import.meta.url))], { encoding: "utf8" }).trim();\n`,
  "src/edge/child-script.mjs": `import { k } from "./child-dep.mjs";\nconsole.log(k);\n`,
  "src/edge/child-dep.mjs": `export const k = "child";\n`,
};
for (const [p, s] of Object.entries(edge)) w(`packages/core/${p}`, s);

// generated core modules: mixed specifier styles, local and global edges
const styles = [
  (from, j) => `./m${pad(j)}.js`,
  (from, j) => `./m${pad(j)}`,
  (from, j) => `~/m${pad(j)}`,
  (from, j) => `#internal/m${pad(j)}`,
];
const FEAT = Math.max(1, Math.floor(CORE / 35));
for (let i = 0; i < CORE; i++) {
  const deps = new Set();
  if (i > 0) { deps.add(Math.max(0, i - 1 - rnd(Math.min(i, 30)))); if (i > 2) deps.add(Math.max(0, i - 1 - rnd(Math.min(i, 30)))); }
  if (i > 50 && rnd(4) === 0) deps.add(rnd(i));
  const lines = [...deps].map((j, k) => `import { m${pad(j)} } from "${styles[(i + k) % 4](i, j)}";`);
  const extra = [];
  if (UTIL > 0 && rnd(5) === 0) { const u = rnd(UTIL); lines.push(rnd(2) ? `import { u${pad(u)} } from "@ref/util/u${pad(u)}";` : `import { u000 as u${pad(u)} } from "@ref/util";`); extra.push(`u${pad(u)}()`); }
  if (i > 0 && i % 35 === 0) { lines.push(`import { feat${(i / 35) - 1} } from "./feat${(i / 35) - 1}";`); extra.push(`feat${(i / 35) - 1}()`); }
  w(`packages/core/src/m${pad(i)}.ts`, lines.join("\n") +
    `\nconst v = (${[...[...deps].map((j) => `m${pad(j)}()`), ...extra].join(" + ") || "0"}) % 997 + 1;\nexport const m${pad(i)} = (): number => v;\n`);
}
for (let f = 0; f < FEAT; f++) {
  const members = Array.from({ length: 3 }, (_, k) => Math.min(CORE - 1, f * 35 + k));
  w(`packages/core/src/feat${f}/index.ts`, [...new Set(members)].map((m) => `export { m${pad(m)} } from "../m${pad(m)}.js";`).join("\n") +
    `\nexport const feat${f} = (): number => 1;\n`);
}

// unit tests: node:test, *.test.ts
for (let t = 0; t < TESTS; t++) {
  const targets = [...new Set([CORE - 1 - rnd(Math.min(CORE, 200)), rnd(CORE)])];
  w(`packages/core/test/unit/t${pad(t)}.test.ts`,
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\n` +
    targets.map((m) => `import { m${pad(m)} } from "../../src/m${pad(m)}.js";`).join("\n") +
    `\n` + targets.map((m) => `test("m${pad(m)} is positive", () => { assert.ok(m${pad(m)}() > 0); });`).join("\n") + `\n`);
}
// one unit test that touches every edge case
w("packages/core/test/unit/edge.test.ts", `import { test } from "node:test";
import assert from "node:assert/strict";
import { a } from "../../src/edge/js-means-ts.ts";
import { g } from "../../src/edge/type-only.js";
import { h } from "../../src/edge/dyn-literal.js";
import { plugin } from "../../src/edge/computed.js";
import { legacy } from "../../src/edge/cjs-user.js";
import { j } from "../../src/edge/json-user.js";
import { fsRead } from "../../src/edge/fs-reader.js";
import { spawned } from "../../src/edge/spawner.js";
import { viaVar } from "../../src/edge/computed-var.js";
import { area } from "../../src/edge/type-implicit.js";
test("chain", () => assert.ok(a() > 0));
test("type-only", () => assert.equal(g({ x: 1 }), 1));
test("dynamic literal", async () => assert.equal(await h(), 8));
test("computed", async () => assert.equal(await plugin("alpha"), "alpha"));
test("require", () => assert.equal(legacy(), 10));
test("json", () => assert.equal(j(), 10));
test("fs read", () => assert.equal(fsRead(), "from-disk"));
test("child process", () => assert.equal(spawned(), "child"));
test("computed variable", async () => assert.equal(await viaVar(), 11));
test("implicit type-only", () => assert.equal(area({ w: 2 }), 2));
`);
w("packages/core/test/e2e/pkg.test.ts", `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { upper } from "@ref/util/str";\ntest("e2e", () => assert.equal(upper("a"), "A"));\n`);

// what `npm install` does for a workspace: a symlink under the root node_modules
mkdirSync(join(out, "node_modules/@ref"), { recursive: true });
symlinkSync("../../packages/util", join(out, "node_modules/@ref/util"));
symlinkSync("../../packages/core", join(out, "node_modules/@ref/core"));
console.log(`fixture ${out}: core ${CORE}, util ${UTIL}, edge ${Object.keys(edge).length}, unit tests ${TESTS + 1}`);
