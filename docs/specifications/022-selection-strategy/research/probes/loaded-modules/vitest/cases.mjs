// Throwaway probe (spec 022 research, loaded-modules): soundness cases.
// Usage: node scripts/cases.mjs [caseName...]   (from $TMPDIR/lm-vitest)
// Each case: fresh fixture, run 1 (records loaded set), edit, run 2.
import fs from "node:fs";
import path from "node:path";
import { SCRATCH, makeFixture, runVitest, writeFiles, load1 } from "./lib.mjs";

const cfg = (test = "", top = "") => `import { defineConfig } from "vitest/config";
export default defineConfig({ ${top} test: { setupFiles: ["./lm-recorder.ts"${test.setup ?? ""}], include: ["**/*.test.ts"], ${test.rest ?? test} } });
`;
const T = "a.test.ts";
const t = (body, imports = "") => `import { test, expect } from "vitest";\n${imports}\n${body}\n`;

export const cases = [
  {
    name: "1a-resolve-dir-then-file",
    files: { "vitest.config.ts": cfg(), "util/index.ts": "export const v = 1;\n", [T]: t(`test("v", () => expect(v).toBe(1));`, `import { v } from "./util";`) },
    edit: { "util.ts": "export const v = 2;\n" },
    edited: ["util.ts"], staticClosure: "no (path did not exist; graph held util/index.ts)",
  },
  {
    name: "1b-resolve-extension-priority",
    files: { "vitest.config.ts": cfg(), "util.ts": "export const v = 1;\n", [T]: t(`test("v", () => expect(v).toBe(1));`, `import { v } from "./util";`) },
    edit: { "util.js": "export const v = 2;\n" },
    edited: ["util.js"], staticClosure: "no (new file; graph held util.ts)",
  },
  {
    name: "1c-glob-new-file",
    files: {
      "vitest.config.ts": cfg(), "plugins/a.ts": "export const name = 'a';\n",
      [T]: t(`test("plugins", () => { const m = import.meta.glob("./plugins/*.ts", { eager: true }); expect(Object.keys(m)).toEqual(["./plugins/a.ts"]); });`),
    },
    edit: { "plugins/b.ts": "export const name = 'b';\n" },
    edited: ["plugins/b.ts"], staticClosure: "yes if the closure keeps the glob pattern (Squeal: 'glob expansions'); the new file itself was not in run 1's graph",
  },
  {
    name: "1d-new-manual-mock-file",
    files: {
      "vitest.config.ts": cfg(), "dep.ts": "export function f() { return 'real'; }\n",
      [T]: t(`vi.mock("./dep");\ntest("automocked", () => expect(f()).toBeUndefined());`, `import { vi } from "vitest";\nimport { f } from "./dep";`),
    },
    edit: { "__mocks__/dep.ts": "export function f() { return 'manual'; }\n" },
    edited: ["__mocks__/dep.ts"], staticClosure: "no (new file, found by Vitest's __mocks__ lookup, not an import)",
  },
  {
    name: "2a-vi-mock-factory",
    files: {
      "vitest.config.ts": cfg(), "dep.ts": "export const v = 'real';\n",
      [T]: t(`vi.mock("./dep", () => ({ v: "mocked" }));\ntest("factory", () => expect(v).toBe("mocked"));`, `import { vi } from "vitest";\nimport { v } from "./dep";`),
    },
    edit: { "dep.ts": "export const v = 'changed';\nthrow new Error('boom');\n" },
    edited: ["dep.ts"], staticClosure: "yes (static import of ./dep)",
  },
  {
    name: "2b-vi-mock-importOriginal",
    files: {
      "vitest.config.ts": cfg(), "dep.ts": "export const v = 'real';\nexport const w = 'w';\n",
      [T]: t(`vi.mock("./dep", async (importOriginal) => ({ ...(await importOriginal<any>()), w: "mocked" }));\ntest("partial", () => { expect(v).toBe("real"); expect(w).toBe("mocked"); });`, `import { vi } from "vitest";\nimport { v, w } from "./dep";`),
    },
    edit: { "dep.ts": "export const v = 'changed';\nexport const w = 'w';\n" },
    edited: ["dep.ts"], staticClosure: "yes",
  },
  {
    name: "2c-vi-mock-automock",
    files: {
      "vitest.config.ts": cfg(), "dep.ts": "export function f() { return 1; }\nexport const k = 5;\n",
      [T]: t(`vi.mock("./dep");\ntest("auto", () => { expect(f()).toBeUndefined(); expect(k).toBe(5); });`, `import { vi } from "vitest";\nimport { f, k } from "./dep";`),
    },
    edit: { "dep.ts": "export function f() { return 1; }\nexport const k = 6;\n" },
    edited: ["dep.ts"], staticClosure: "yes",
  },
  {
    name: "3a-fs-readFileSync-json",
    files: {
      "vitest.config.ts": cfg(), "data.json": '{ "n": 1 }\n',
      [T]: t(`test("read", () => expect(JSON.parse(fs.readFileSync(new URL("./data.json", import.meta.url), "utf8")).n).toBe(1));`, `import fs from "node:fs";`),
    },
    edit: { "data.json": '{ "n": 2 }\n' },
    edited: ["data.json"], staticClosure: "no in the import graph (Squeal's observed reads may record it; not checked here)",
  },
  {
    name: "3b-raw-import",
    files: { "vitest.config.ts": cfg(), "a.txt": "hello\n", [T]: t(`test("raw", () => expect(txt.trim()).toBe("hello"));`, `import txt from "./a.txt?raw";`) },
    edit: { "a.txt": "bye\n" },
    edited: ["a.txt"], staticClosure: "yes (import with ?raw query)",
  },
  {
    name: "3c-json-import",
    files: { "vitest.config.ts": cfg(), "data.json": '{ "n": 1 }\n', [T]: t(`test("json", () => expect(data.n).toBe(1));`, `import data from "./data.json";`) },
    edit: { "data.json": '{ "n": 2 }\n' },
    edited: ["data.json"], staticClosure: "yes",
  },
  {
    name: "4a-config-test-env",
    files: { "vitest.config.ts": cfg(`env: { X: "1" }`), [T]: t(`test("env", () => expect(process.env.X).toBe("1"));`) },
    edit: { "vitest.config.ts": cfg(`env: { X: "2" }`) },
    edited: ["vitest.config.ts"], staticClosure: "no in the test's import graph; yes in Squeal's config closure",
  },
  {
    name: "4b-dotenv-file",
    files: { "vitest.config.ts": cfg(), ".env": "VITE_FOO=1\n", [T]: t(`test("dotenv", () => expect(import.meta.env.VITE_FOO).toBe("1"));`) },
    edit: { ".env": "VITE_FOO=2\n" },
    edited: [".env"], staticClosure: "no (not imported; config closure only if Squeal hashes .env files)",
  },
  {
    name: "4c-shell-env",
    files: { "vitest.config.ts": cfg(), [T]: t(`test("shell env", () => expect(process.env.LM_X).toBe("1"));`) },
    run1Env: { LM_X: "1" }, run2Env: { LM_X: "2" }, edit: {},
    edited: [], staticClosure: "no file at all (process environment of the runner)",
  },
  {
    name: "5-child-process",
    files: {
      "vitest.config.ts": cfg(), "lib.mjs": "export const v = 1;\n", "child.mjs": "import { v } from './lib.mjs';\nprocess.stdout.write(String(v));\n",
      [T]: t(`test("child", () => expect(execFileSync(process.execPath, [new URL("./child.mjs", import.meta.url).pathname], { encoding: "utf8" })).toBe("1"));`, `import { execFileSync } from "node:child_process";`),
    },
    edit: { "lib.mjs": "export const v = 2;\n" },
    edited: ["lib.mjs"], staticClosure: "no (child.mjs is a path string, not an import)",
  },
  {
    name: "6a-setup-file-import",
    files: {
      "vitest.config.ts": cfg({ setup: `, "./setup.ts"`, rest: "" }), "setup.ts": "import { flag } from './setup-helper';\n(globalThis as any).FLAG = flag;\n",
      "setup-helper.ts": "export const flag = 1;\n", [T]: t(`test("flag", () => expect((globalThis as any).FLAG).toBe(1));`),
    },
    edit: { "setup-helper.ts": "export const flag = 2;\n" },
    edited: ["setup-helper.ts"], staticClosure: "no in the test's graph; yes in Squeal's setup closure",
  },
  {
    name: "6b-config-define",
    files: { "vitest.config.ts": cfg("", `define: { __FLAG__: "1" },`), [T]: t(`declare const __FLAG__: number;\ntest("define", () => expect(__FLAG__).toBe(1));`) },
    edit: { "vitest.config.ts": cfg("", `define: { __FLAG__: "2" },`) },
    edited: ["vitest.config.ts"], staticClosure: "config closure only",
  },
  {
    name: "6c-config-globals",
    files: { "vitest.config.ts": cfg(`globals: true`), [T]: `test("globals", () => expect(1).toBe(1));\n` },
    edit: { "vitest.config.ts": cfg(`globals: false`) },
    edited: ["vitest.config.ts"], staticClosure: "config closure only",
  },
  {
    name: "6d-globalSetup-provide",
    files: {
      "vitest.config.ts": cfg(`globalSetup: ["./global-setup.ts"]`), "global-setup.ts": "import { val } from './gs-helper';\nexport default function ({ provide }: any) { provide('val', val); }\n",
      "gs-helper.ts": "export const val = 1;\n", [T]: t(`test("inject", () => expect(inject("val" as any)).toBe(1));`, `import { inject } from "vitest";`),
    },
    edit: { "gs-helper.ts": "export const val = 2;\n" },
    edited: ["gs-helper.ts"], staticClosure: "no in the test's graph; config closure if Squeal follows globalSetup imports",
  },
  {
    name: "7a-untaken-dynamic-edit-heavy",
    files: {
      "vitest.config.ts": cfg(), "flag.ts": "export const flag = false;\n", "heavy.ts": "export const r = 'heavy';\n",
      [T]: t(`test("dyn", async () => { let r = "none"; if (flag) r = (await import("./heavy")).r; expect(r).toBe("none"); });`, `import { flag } from "./flag";`),
    },
    edit: { "heavy.ts": "export const r = 'changed';\nthrow new Error('boom');\n" },
    edited: ["heavy.ts"], staticClosure: "yes (dynamic import)",
  },
  {
    name: "7b-untaken-dynamic-flip-flag",
    files: {
      "vitest.config.ts": cfg(), "flag.ts": "export const flag = false;\n", "heavy.ts": "export const r = 'heavy';\n",
      [T]: t(`test("dyn", async () => { let r = "none"; if (flag) r = (await import("./heavy")).r; expect(r).toBe("none"); });`, `import { flag } from "./flag";`),
    },
    edit: { "flag.ts": "export const flag = true;\n" },
    edited: ["flag.ts"], staticClosure: "yes",
  },
  {
    name: "8a-import-type",
    files: { "vitest.config.ts": cfg(), "types.ts": "export interface T { a: number }\n", [T]: t(`test("type", () => { const x: T = { a: 1 }; expect(x.a).toBe(1); });`, `import type { T } from "./types";`) },
    edit: { "types.ts": "export interface T { a: number }\nexport const x = 1;\nthrow new Error('boom');\n" },
    edited: ["types.ts"], staticClosure: "Vite's transformed graph: no (import elided); a source-level import scan: yes",
  },
  {
    name: "8b-import-without-type-keyword",
    files: { "vitest.config.ts": cfg(), "types.ts": "export interface T { a: number }\n", [T]: t(`test("type", () => { const x: T = { a: 1 }; expect(x.a).toBe(1); });`, `import { T } from "./types";`) },
    edit: { "types.ts": "export interface T { a: number }\nexport const x = 1;\nthrow new Error('boom');\n" },
    edited: ["types.ts"], staticClosure: "transformed graph: no if elided",
  },
  {
    name: "8c-export-type-reexport",
    files: {
      "vitest.config.ts": cfg(), "types.ts": "export interface T { a: number }\n", "index.ts": "export type { T } from './types';\nexport const v = 1;\n",
      [T]: t(`test("v", () => expect(v).toBe(1));`, `import { v } from "./index";`),
    },
    edit: { "types.ts": "export interface T { a: number }\nthrow new Error('boom');\n" },
    edited: ["types.ts"], staticClosure: "transformed graph: no",
  },
  {
    name: "8d-plain-reexport-of-type",
    files: {
      "vitest.config.ts": cfg(), "types.ts": "export interface T { a: number }\n", "index.ts": "export { T } from './types';\nexport const v = 1;\n",
      [T]: t(`test("v", () => expect(v).toBe(1));`, `import { v } from "./index";`),
    },
    edit: { "types.ts": "export interface T { a: number }\nthrow new Error('boom');\n" },
    edited: ["types.ts"], staticClosure: "yes (re-export kept: isolated transform cannot know T is a type)",
  },
  {
    name: "9-snapshot-file",
    files: { "vitest.config.ts": cfg(), [T]: t(`test("snap", () => expect({ a: 1 }).toMatchSnapshot());`) },
    prerun: true,
    edit: (dir) => {
      const p = path.join(dir, "__snapshots__", "a.test.ts.snap");
      return { "__snapshots__/a.test.ts.snap": fs.readFileSync(p, "utf8").replace('"a": 1', '"a": 2') };
    },
    edited: ["__snapshots__/a.test.ts.snap"], staticClosure: "no (read by the snapshot state via fs)",
  },
  {
    name: "10a-node_modules-package-inner",
    files: {
      "vitest.config.ts": cfg(), "node_modules/fakepkg/package.json": '{ "name": "fakepkg", "type": "module", "main": "index.js" }\n',
      "node_modules/fakepkg/index.js": "export { v } from './inner.js';\n", "node_modules/fakepkg/inner.js": "export const v = 1;\n",
      [T]: t(`test("pkg", () => expect(v).toBe(1));`, `import { v } from "fakepkg";`),
    },
    edit: { "node_modules/fakepkg/inner.js": "export const v = 2;\n" },
    edited: ["node_modules/fakepkg/inner.js"], staticClosure: "package files: depends on whether Squeal follows into node_modules",
  },
  {
    name: "10b-file-linked-package",
    files: {
      "vitest.config.ts": cfg(), "linkpkg-src/package.json": '{ "name": "linkpkg", "type": "module", "main": "index.js" }\n',
      "linkpkg-src/index.js": "export { v } from './inner.js';\n", "linkpkg-src/inner.js": "export const v = 1;\n",
      "node_modules/linkpkg": { symlink: "../linkpkg-src" },
      [T]: t(`test("pkg", () => expect(v).toBe(1));`, `import { v } from "linkpkg";`),
    },
    edit: { "linkpkg-src/inner.js": "export const v = 2;\n" },
    edited: ["linkpkg-src/inner.js"], staticClosure: "yes if the graph follows the realpath (inlined)",
  },
  {
    name: "11a-createRequire-cjs",
    files: {
      "vitest.config.ts": cfg(), "c.cjs": "module.exports = require('./c2.cjs');\n", "c2.cjs": "module.exports = { v: 1 };\n",
      [T]: t(`const require = createRequire(import.meta.url);\ntest("cjs", () => expect(require("./c.cjs").v).toBe(1));`, `import { createRequire } from "node:module";`),
    },
    edit: { "c2.cjs": "module.exports = { v: 2 };\n" },
    edited: ["c2.cjs"], staticClosure: "no (createRequire: Squeal marks an 'unnamed load')",
  },
  {
    name: "11b-plain-require-in-esm-test",
    files: {
      "vitest.config.ts": cfg(), "c.cjs": "module.exports = require('./c2.cjs');\n", "c2.cjs": "module.exports = { v: 1 };\n",
      [T]: t(`test("cjs", () => expect(require("./c.cjs").v).toBe(1));`),
    },
    edit: { "c2.cjs": "module.exports = { v: 2 };\n" },
    edited: ["c2.cjs"], staticClosure: "c.cjs yes (literal require); c2.cjs only if the closure scans c.cjs's requires",
  },
  {
    name: "11c-import-cjs-project-file",
    files: {
      "vitest.config.ts": cfg(), "c.cjs": "module.exports = require('./c2.cjs');\n", "c2.cjs": "module.exports = { v: 1 };\n",
      [T]: t(`test("cjs", () => expect(c.v).toBe(1));`, `import c from "./c.cjs";`),
    },
    edit: { "c2.cjs": "module.exports = { v: 2 };\n" },
    edited: ["c2.cjs"], staticClosure: "c.cjs yes; c2.cjs if literal require is followed",
  },
  {
    name: "11d-tsconfig-useDefineForClassFields",
    files: {
      "vitest.config.ts": cfg(), "tsconfig.json": '{ "compilerOptions": { "target": "ES2022", "useDefineForClassFields": false } }\n',
      "cls.ts": "class Base { constructor() { (this as any).x = 5; } }\nexport class Derived extends Base { x!: number; }\n",
      [T]: t(`test("field", () => expect(new Derived().x).toBe(5));`, `import { Derived } from "./cls";`),
    },
    edit: { "tsconfig.json": '{ "compilerOptions": { "target": "ES2022", "useDefineForClassFields": true } }\n' },
    edited: ["tsconfig.json"], staticClosure: "no (transform input, not a module)",
  },
  {
    name: "11e-package-json-imports-alias",
    files: {
      "vitest.config.ts": cfg(), "package.json": '{ "name": "fx", "type": "module", "imports": { "#u": "./u1.ts" } }\n',
      "u1.ts": "export const v = 1;\n", "u2.ts": "export const v = 2;\n",
      [T]: t(`test("alias", () => expect(v).toBe(1));`, `import { v } from "#u";`),
    },
    edit: { "package.json": '{ "name": "fx", "type": "module", "imports": { "#u": "./u2.ts" } }\n' },
    edited: ["package.json", "(u2.ts now resolved)"], staticClosure: "no (package.json is resolution input)",
  },
  {
    name: "11f-worker-thread",
    files: {
      "vitest.config.ts": cfg(), "wlib.mjs": "export const v = 1;\n", "w.mjs": "import { parentPort } from 'node:worker_threads';\nimport { v } from './wlib.mjs';\nparentPort.postMessage(v);\n",
      [T]: t(`test("worker", async () => { const w = new Worker(new URL("./w.mjs", import.meta.url)); const v = await new Promise((r) => w.once("message", r)); await w.terminate(); expect(v).toBe(1); });`, `import { Worker } from "node:worker_threads";`),
    },
    edit: { "wlib.mjs": "export const v = 2;\n" },
    edited: ["wlib.mjs"], staticClosure: "no (URL string, not an import)",
  },
  {
    name: "12-load-failure-run1",
    files: {
      "vitest.config.ts": cfg(), "a.ts": "export { b } from './b';\n", "b.ts": "export const b = 1;\nthrow new Error('broken at load');\n",
      [T]: t(`test("b", () => expect(b).toBe(1));`, `import { b } from "./a";`),
    },
    edit: { "b.ts": "export const b = 1;\n" },
    edited: ["b.ts"], staticClosure: "yes",
  },
  {
    name: "13-vi-resetModules-in-afterEach",
    files: {
      "vitest.config.ts": cfg(), "dep.ts": "export const v = 1;\n",
      [T]: t(`afterEach(() => { vi.resetModules(); });\ntest("v", () => expect(v).toBe(1));`, `import { vi, afterEach } from "vitest";\nimport { v } from "./dep";`),
    },
    edit: { "dep.ts": "export const v = 2;\n" },
    edited: ["dep.ts"], staticClosure: "yes",
  },
];

const only = process.argv.slice(2);
const results = [];
for (const c of cases) {
  if (only.length && !only.some((o) => c.name.startsWith(o))) continue;
  const dir = path.join(SCRATCH, "cases", c.name);
  makeFixture(dir, c.files);
  if (c.prerun) runVitest(dir, "run0", { env: c.run1Env });
  const r1 = runVitest(dir, "run1", { env: c.run1Env });
  const edit = typeof c.edit === "function" ? c.edit(dir) : c.edit;
  writeFiles(dir, edit);
  const r2 = runVitest(dir, "run2", { env: c.run2Env ?? c.run1Env });
  const set1 = r1.sets[T]?.loadedFiles ?? null;
  const ids1 = r1.sets[T]?.ids ?? null;
  const editedIn = c.edited.map((e) => ({
    path: e,
    inLoadedSet: set1 ? set1.includes(e) : "no record",
    anyIdMentions: ids1 ? ids1.some((i) => String(i.id).includes(e.replace(/^node_modules\//, "")) || String(i.ext ?? "").includes(e)) : "no record",
  }));
  const res = {
    case: c.name,
    run1: r1.files[T] ?? r1.files,
    run2: r2.files[T] ?? r2.files,
    changed: (r1.files[T]?.status ?? "?") !== (r2.files[T]?.status ?? "?"),
    run1LoadedSet: set1,
    run1Ids: ids1,
    editedIn,
    staticClosure: c.staticClosure,
    load1: load1(),
  };
  results.push(res);
  console.log(JSON.stringify({ case: c.name, r1: res.run1.status, r2: res.run2.status, changed: res.changed, editedIn, set1 }));
}
const outFile = path.join(SCRATCH, "results-cases.json");
let prev = [];
try { prev = JSON.parse(fs.readFileSync(outFile, "utf8")); } catch {}
const merged = [...prev.filter((p) => !results.some((r) => r.case === p.case)), ...results].sort((a, b) => a.case.localeCompare(b.case, "en", { numeric: true }));
fs.writeFileSync(outFile, JSON.stringify(merged, null, 1));
