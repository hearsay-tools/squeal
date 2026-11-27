import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../../src/core/types/common.js";
import { resolveJest } from "../../../../src/runners/jest/resolve.js";
import { takeRecorded } from "../../../../src/runners/observe/read.js";
import { observeEnv } from "../../../../src/runners/observe/runtime.js";
import { installJest, JEST_MAJORS } from "../../../helpers/jest-env.js";

/*
 * Spec 028 D3: `observe-runtime.cjs` lists each test file's module loads inside Jest's VM
 * sandbox, and names the running file for `recorder.cjs`, so two files in one `--runInBand`
 * process each get only their own reads and spawns. Real Jest 29.7.0 and 30.5.2.
 */

const SRC = resolve(import.meta.dirname, "../../../../src/runners");
const OBSERVE_RUNTIME = join(SRC, "jest/runtime/observe-runtime.cjs");
const RECORDER = join(SRC, "observe/recorder.cjs") as AbsolutePath;

const CONFIG = `module.exports = {
  testEnvironment: "node",
  testMatch: ["<rootDir>/test/**/*.test.{js,mjs}"],
  moduleNameMapper: { "^@lib/(.*)$": "<rootDir>/lib/$1" },
  setupFiles: ["<rootDir>/lib/setup-env.js"],
  setupFilesAfterEnv: ["<rootDir>/lib/setup-after.js"],
  runtime: ${JSON.stringify(OBSERVE_RUNTIME)},
};
`;

/** Reads `data/<name>-top.txt` while loading, `data/<name>.txt` and spawns `data/child-<name>.js` in its test. */
const testFile = (name: string, requires: string) => `const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
${requires}
fs.readFileSync(path.join(__dirname, "../data/${name}-top.txt"));
test("${name}", () => {
  fs.readFileSync(path.join(__dirname, "../data/${name}.txt"));
  execFileSync(process.execPath, [path.join(__dirname, "../data/child-${name}.js")]);
  expect(subject.ok).toBe(true);
});
`;

const FILES: Readonly<Record<string, string>> = {
  "package.json": `{ "name": "observe-fixture", "private": true }\n`,
  "jest.config.js": CONFIG,
  "lib/setup-env.js": `require("./env-helper");\n`,
  "lib/env-helper.js": `module.exports = 1;\n`,
  "lib/setup-after.js": `require("./after-helper");\n`,
  "lib/after-helper.js": `module.exports = 2;\n`,
  "lib/mapped.js": `module.exports = 3;\n`,
  "src/a.js": `const data = require("./data.json");
const mapped = require("@lib/mapped");
const workspace = require("pkg-b");
const name = ["dy", "n"].join("");
const dyn = require("./" + name);
const mocked = require("./mocked");
module.exports = { ok: data.ok && mapped === 3 && workspace === 4 && dyn === 5 && mocked === "mock" };
`,
  "src/data.json": `{ "ok": true }\n`,
  "src/dyn.js": `module.exports = 5;\n`,
  "src/mocked.js": `module.exports = "real";\n`,
  "src/__mocks__/mocked.js": `module.exports = "mock";\n`,
  "src/b.js": `module.exports = { ok: true };\n`,
  "src/esm.mjs": `export const ok = true;\n`,
  "packages/pkg-b/package.json": `{ "name": "pkg-b", "main": "index.js" }\n`,
  "packages/pkg-b/index.js": `module.exports = 4;\n`,
  "test/a.test.js": testFile(
    "a",
    `jest.mock("../src/mocked");\nconst subject = require("../src/a");`,
  ),
  "test/b.test.js": testFile("b", `const subject = require("../src/b");`),
  "test/c.test.mjs": `import { ok } from "../src/esm.mjs";\ntest("c", () => expect(ok).toBe(true));\n`,
  "data/a-top.txt": "a\n",
  "data/a.txt": "a\n",
  "data/b-top.txt": "b\n",
  "data/b.txt": "b\n",
  "data/child-a.js": "\n",
  "data/child-b.js": "\n",
};

let scratch: string;
beforeAll(() => {
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "squeal-jest-observe-")));
});
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A copy of the fixture whose `node_modules` links the installed Jest and the workspace package. */
function project(major: 29 | 30): AbsolutePath {
  const root = join(scratch, `jest-${major}`);
  for (const [path, text] of Object.entries(FILES)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  mkdirSync(join(root, "node_modules"));
  symlinkSync(
    realpathSync(join(installJest(major), "node_modules/jest")),
    join(root, "node_modules/jest"),
  );
  symlinkSync("../packages/pkg-b", join(root, "node_modules/pkg-b"));
  return root as AbsolutePath;
}

interface Observed {
  readonly loaded: ReadonlyMap<string, readonly string[]>;
  readonly recorded: ReturnType<typeof takeRecorded>;
}

/** One `--runInBand` Jest run over every test file, observed by both. */
function runJest(root: AbsolutePath): Observed {
  const resolution = resolveJest("observe", root, root);
  if (!resolution.ok) throw new Error(resolution.note);
  const out = join(root, ".observed") as AbsolutePath;
  const loadedOut = join(root, ".loaded.ndjson");
  mkdirSync(out);
  const env = observeEnv(RECORDER, { out, root, skip: [] }, process.env.NODE_OPTIONS);
  execFileSync(
    process.execPath,
    [
      resolution.install.bin,
      "--config",
      join(root, "jest.config.js"),
      "--runInBand",
      "--ci",
      "--cacheDirectory",
      join(root, ".cache"),
    ],
    {
      cwd: root,
      stdio: "pipe",
      timeout: 120_000,
      env: {
        ...process.env,
        ...env,
        NODE_OPTIONS: `${env.NODE_OPTIONS} --experimental-vm-modules`,
        SQUEAL_JEST_RUNTIME: resolution.install.runtime,
        SQUEAL_JEST_LOADED_OUT: loadedOut,
      },
    },
  );
  const loaded = new Map<string, string[]>();
  for (const line of readFileSync(loadedOut, "utf8").split("\n").filter(Boolean)) {
    const entry = JSON.parse(line) as { testPath: string; loaded: string[] };
    loaded.set(
      rel(root, entry.testPath),
      entry.loaded.map((p) => rel(root, p)),
    );
  }
  return { loaded, recorded: takeRecorded(out) };
}

const rel = (root: string, path: string) =>
  path.startsWith(root + sep) ? path.slice(root.length + 1) : path;

describe.each(JEST_MAJORS)("observe-runtime.cjs on Jest %i", (major) => {
  let root: AbsolutePath;
  let observed: Observed;
  beforeAll(() => {
    root = project(major);
    observed = runJest(root);
  }, 240_000);

  const setup = [
    "lib/setup-env.js",
    "lib/env-helper.js",
    "lib/setup-after.js",
    "lib/after-helper.js",
  ];

  it("lists each file's CJS, JSON, mapped, mocked, workspace, computed and setup modules", () => {
    const a = observed.loaded.get("test/a.test.js");
    expect(a).toEqual(
      expect.arrayContaining([
        "test/a.test.js",
        "src/a.js",
        "src/data.json",
        "lib/mapped.js",
        "src/dyn.js",
        "src/__mocks__/mocked.js",
        "packages/pkg-b/index.js",
        ...setup,
      ]),
    );
    expect(a).not.toContain("src/b.js");
    expect(a?.filter((p) => p.includes("node_modules"))).toEqual([]);
    const b = observed.loaded.get("test/b.test.js");
    expect(b).toEqual(expect.arrayContaining(["test/b.test.js", "src/b.js", ...setup]));
    expect(b).not.toContain("src/a.js");
  });

  it("lists an ESM test file's imports", () => {
    expect(observed.loaded.get("test/c.test.mjs")).toEqual(
      expect.arrayContaining(["test/c.test.mjs", "src/esm.mjs", ...setup]),
    );
  });

  it("gives the recorder each file's own reads and spawns in one --runInBand process", () => {
    const paths = (file: string) =>
      [...(observed.recorded.get(join(root, file) as AbsolutePath)?.paths ?? [])].map((p) =>
        rel(root, p),
      );
    const a = paths("test/a.test.js");
    const b = paths("test/b.test.js");
    expect(a).toEqual(expect.arrayContaining(["data/a-top.txt", "data/a.txt", "data/child-a.js"]));
    expect(b).toEqual(expect.arrayContaining(["data/b-top.txt", "data/b.txt", "data/child-b.js"]));
    expect(a.filter((p) => p.startsWith("data/b") || p === "data/child-b.js")).toEqual([]);
    expect(b.filter((p) => p.startsWith("data/a") || p === "data/child-a.js")).toEqual([]);
  });

  it("gives the recorder none of the absent files Jest's transform and resolver probe", () => {
    // Row 028-08 (F1): `babel-jest`, Browserslist and `jest-resolve` look for these as modules load.
    const absent = (p: string) =>
      /(?:^|\/)(?:\.babelrc[^/]*|\.babelignore|babel\.config\.[cm]?ts|\.browserl?i?s?t?s?rc|browserl?i?s?t?)$/.test(
        p,
      ) ||
      /(?:^|\/)package\.json$/.test(p) ||
      /^src\/(?:a|b|dyn|mocked|data)$/.test(p);
    for (const file of ["test/a.test.js", "test/b.test.js", "test/c.test.mjs"]) {
      const paths = [...(observed.recorded.get(join(root, file) as AbsolutePath)?.paths ?? [])]
        .map((p) => rel(root, p))
        .filter((p) => !existsSync(join(root, p)));
      expect(paths.filter(absent)).toEqual([]);
    }
  });
});
