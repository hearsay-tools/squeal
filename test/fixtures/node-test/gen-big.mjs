// Generates the cost fixture of spec 003: a reference-shaped workspace with
// 700 modules in packages/core, 300 in packages/util and 200 unit test files,
// deterministic for a given size. Moved from the research probe
// research/probes/node-test-module-graph/gen-fixture.mjs; its hand-written
// edge cases live in ./edge instead.
//
// usage: node gen-big.mjs [outDir] [coreModules] [utilModules] [testFiles]
// default: node gen-big.mjs big 700 300 200
// The default outDir is ./big next to this file, git-ignored.
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const [outArg, coreArg = "700", utilArg = "300", testArg = "200"] = process.argv.slice(2);
const out = resolve(outArg ?? join(import.meta.dirname, "big"));
const CORE = Number(coreArg);
const UTIL = Number(utilArg);
const TESTS = Number(testArg);

rmSync(out, { recursive: true, force: true });
const write = (path, text) => {
  mkdirSync(dirname(join(out, path)), { recursive: true });
  writeFileSync(join(out, path), text);
};
let seed = 42;
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed % n;
};
const pad = (i) => String(i).padStart(3, "0");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

write("package.json", json({ name: "big-root", private: true, type: "module", workspaces: ["packages/*"] }));
write("scripts/preload.mjs", `import { marker } from "./lib/marker.mjs";\nglobalThis.fixturePreload = marker();\n`);
write("scripts/lib/marker.mjs", `export const marker = () => "preloaded";\n`);

// packages/util: an exports map with a wildcard, imported by name through a symlink
write("packages/util/package.json", json({
  name: "@big/util",
  type: "module",
  exports: { ".": "./src/index.ts", "./*": "./src/*.ts" },
}));
for (let i = 0; i < UTIL; i++) {
  const deps = i === 0 ? [] : [...new Set([rnd(i), ...(i > 1 ? [Math.max(0, i - 1 - rnd(20))] : [])])];
  write(`packages/util/src/u${pad(i)}.ts`,
    deps.map((d) => `import { u${pad(d)} } from "./u${pad(d)}.js";`).join("\n") +
    // computed once at module init: calling dependencies at call time is exponential
    `\nconst v = (${deps.map((d) => `u${pad(d)}()`).join(" + ") || "0"}) % 997 + 1;\nexport const u${pad(i)} = (): number => v;\n`);
}
write("packages/util/src/index.ts",
  Array.from({ length: Math.min(UTIL, 10) }, (_, i) => `export { u${pad(i)} } from "./u${pad(i)}.js";`).join("\n") + "\n");

// packages/core: the package under test, with imports map and tsconfig paths
write("packages/core/package.json", json({
  name: "@big/core",
  type: "module",
  imports: { "#internal/*": "./src/*.ts" },
  scripts: {
    "test:unit": "node --import ../../scripts/preload.mjs --import tsx --test test/unit/*.test.ts",
  },
  dependencies: { "@big/util": "*" },
}));
write("packages/core/tsconfig.json", json({
  compilerOptions: {
    target: "es2022", module: "nodenext", moduleResolution: "nodenext", strict: true,
    allowImportingTsExtensions: true, noEmit: true, paths: { "~/*": ["./src/*"] },
  },
}));

// mixed specifier styles, local and long-range edges, a feature barrel every 35 modules
const styles = [
  (j) => `./m${pad(j)}.js`,
  (j) => `./m${pad(j)}`,
  (j) => `~/m${pad(j)}`,
  (j) => `#internal/m${pad(j)}`,
];
const FEAT = Math.max(1, Math.floor(CORE / 35));
for (let i = 0; i < CORE; i++) {
  const deps = new Set();
  if (i > 0) {
    deps.add(Math.max(0, i - 1 - rnd(Math.min(i, 30))));
    if (i > 2) deps.add(Math.max(0, i - 1 - rnd(Math.min(i, 30))));
  }
  if (i > 50 && rnd(4) === 0) deps.add(rnd(i));
  const lines = [...deps].map((j, k) => `import { m${pad(j)} } from "${styles[(i + k) % 4](j)}";`);
  const extra = [];
  if (UTIL > 0 && rnd(5) === 0) {
    const u = rnd(UTIL);
    lines.push(rnd(2) ? `import { u${pad(u)} } from "@big/util/u${pad(u)}";` : `import { u000 as u${pad(u)} } from "@big/util";`);
    extra.push(`u${pad(u)}()`);
  }
  if (i > 0 && i % 35 === 0) {
    const f = i / 35 - 1;
    lines.push(`import { feat${f} } from "./feat${f}";`);
    extra.push(`feat${f}()`);
  }
  const sum = [...[...deps].map((j) => `m${pad(j)}()`), ...extra].join(" + ") || "0";
  write(`packages/core/src/m${pad(i)}.ts`,
    `${lines.join("\n")}\nconst v = (${sum}) % 997 + 1;\nexport const m${pad(i)} = (): number => v;\n`);
}
for (let f = 0; f < FEAT; f++) {
  const members = [...new Set(Array.from({ length: 3 }, (_, k) => Math.min(CORE - 1, f * 35 + k)))];
  write(`packages/core/src/feat${f}/index.ts`,
    members.map((m) => `export { m${pad(m)} } from "../m${pad(m)}.js";`).join("\n") +
    `\nexport const feat${f} = (): number => 1;\n`);
}

for (let t = 0; t < TESTS; t++) {
  const targets = [...new Set([CORE - 1 - rnd(Math.min(CORE, 200)), rnd(CORE)])];
  write(`packages/core/test/unit/t${pad(t)}.test.ts`,
    `import assert from "node:assert/strict";\nimport { test } from "node:test";\n` +
    targets.map((m) => `import { m${pad(m)} } from "../../src/m${pad(m)}.js";`).join("\n") + "\n" +
    targets.map((m) => `test("m${pad(m)} is positive", () => assert.ok(m${pad(m)}() > 0));`).join("\n") + "\n");
}

// what `npm install` does for a workspace: a symlink under the root node_modules
mkdirSync(join(out, "node_modules/@big"), { recursive: true });
symlinkSync("../../packages/util", join(out, "node_modules/@big/util"));
symlinkSync("../../packages/core", join(out, "node_modules/@big/core"));
console.log(`${out}: ${CORE + UTIL} modules (core ${CORE}, util ${UTIL}), ${FEAT} feature barrels, ${TESTS} test files`);
