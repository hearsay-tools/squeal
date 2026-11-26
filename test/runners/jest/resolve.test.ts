import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../../src/core/types/common.js";
import { resolveJest, tsNodeHygiene } from "../../../src/runners/jest/resolve.js";
import { installJest, JEST_MAJORS } from "../../helpers/jest-env.js";

const scratch = mkdtempSync(join(tmpdir(), "squeal-jest-resolve-"));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

let trees = 0;
/** A fresh folder under the scratch folder, holding `files` (path to text). */
function tree(files: Record<string, string> = {}): AbsolutePath {
  const dir = join(scratch, `t${trees++}`);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
  mkdirSync(dir, { recursive: true });
  return dir as AbsolutePath;
}

/** A package folder's `package.json` and entry, under `node_modules/<name>`. */
function pkg(name: string, version: string, extra: object = {}): Record<string, string> {
  const at = `node_modules/${name}`;
  return {
    [`${at}/package.json`]: JSON.stringify({ name, version, main: "index.js", ...extra }),
    [`${at}/index.js`]: "",
  };
}

/** A flat (npm-hoisted) Jest install of `version`, without the packages named in `missing`. */
function jestTree(version: string, missing: readonly string[] = []): Record<string, string> {
  const names = ["jest-cli", "@jest/core", "jest-config", "jest-runtime"];
  return Object.assign(
    pkg("jest", version, { bin: "./bin/jest.js" }),
    ...names.filter((name) => !missing.includes(name)).map((name) => pkg(name, version)),
  );
}

function manifest(dir: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
}

describe.each(JEST_MAJORS)("resolveJest on a pnpm install of Jest %i (spec 028 D2.1)", (major) => {
  let root = "" as AbsolutePath;
  beforeAll(() => {
    root = installJest(major) as AbsolutePath;
  }, 240_000);

  it("finds jest, jest-cli, @jest/core, jest-config and jest-runtime of that major", () => {
    const resolution = resolveJest("fixture", root, root);
    if (!resolution.ok) throw new Error(resolution.note);
    const { install } = resolution;
    expect(install.major).toBe(major);
    expect(install.version).toMatch(new RegExp(`^${major}\\.`));
    const folders = {
      jest: install.jest,
      "jest-cli": install.cli,
      "@jest/core": install.core,
      "jest-config": install.config,
      "jest-runtime": install.runtime,
    };
    for (const [name, dir] of Object.entries(folders)) {
      expect(manifest(dir)).toMatchObject({ name, version: install.version });
    }
  });

  it("runs on pnpm's strictest layout: only jest at the top, no hidden hoisted folder", () => {
    for (const name of ["jest-cli", "@jest/core", "jest-config", "jest-runtime"]) {
      expect(existsSync(join(root, "node_modules", name))).toBe(false);
    }
    expect(existsSync(join(root, "node_modules/.pnpm/node_modules"))).toBe(false);
  });

  it("names a bin that runs the fixture's test to a pass", () => {
    const resolution = resolveJest("fixture", root, root);
    if (!resolution.ok) throw new Error(resolution.note);
    const cacheDirectory = join(scratch, `cache-${major}`);
    const output = execFileSync(
      process.execPath,
      [resolution.install.bin, "--ci", "--cacheDirectory", cacheDirectory, "--json"],
      { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
    );
    expect(JSON.parse(output)).toMatchObject({ success: true, numPassedTests: 1 });
  });
});

describe("resolveJest on hand-made trees (spec 028 D2.1)", () => {
  it("finds jest in the worktree root from a package folder below it", () => {
    const root = tree({ ...jestTree("29.7.0"), "packages/web/package.json": "{}" });
    const resolution = resolveJest("web", join(root, "packages/web") as AbsolutePath, root);
    expect(resolution).toMatchObject({ ok: true, install: { version: "29.7.0", major: 29 } });
    if (resolution.ok)
      expect(resolution.install.bin).toBe(join(root, "node_modules/jest/bin/jest.js"));
  });

  it("prefers the package's own jest over the root's", () => {
    const root = tree({ ...jestTree("29.7.0") });
    const web = join(root, "packages/web");
    for (const [path, text] of Object.entries(jestTree("30.5.2"))) {
      mkdirSync(join(web, path, ".."), { recursive: true });
      writeFileSync(join(web, path), text);
    }
    expect(resolveJest("web", web as AbsolutePath, root)).toMatchObject({
      ok: true,
      install: { version: "30.5.2", major: 30 },
    });
  });

  it("never takes a jest installed above the worktree root", () => {
    const outer = tree(jestTree("29.7.0"));
    const root = join(outer, "worktree") as AbsolutePath;
    mkdirSync(root);
    const resolution = resolveJest("web", root, root);
    expect(resolution).toEqual({
      ok: false,
      note: `jest project "web": no jest package in node_modules from ${root} up to the worktree root; install jest 29 or 30 in the project (for example \`npm install --save-dev jest\`); its checks stay unknown until then`,
    });
  });

  it.each(["28.1.3", "31.0.0", "27.0.0-next.1"])(
    "leaves jest %s unsupported, with one note",
    (version) => {
      const root = tree(jestTree(version));
      const resolution = resolveJest("web", root, root);
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) {
        expect(resolution.note).toContain(`jest ${version} at ${join(root, "node_modules/jest")}`);
        expect(resolution.note).toContain("outside the supported >= 29.0.0 < 31.0.0");
      }
    },
  );

  it("accepts a Jest 30 prerelease", () => {
    const root = tree(jestTree("30.0.0-alpha.7"));
    expect(resolveJest("web", root, root)).toMatchObject({ ok: true, install: { major: 30 } });
  });

  it("calls an install without jest-runtime incomplete", () => {
    const root = tree(jestTree("29.7.0", ["jest-runtime"]));
    const resolution = resolveJest("web", root, root);
    expect(resolution.ok).toBe(false);
    if (!resolution.ok) {
      expect(resolution.note).toMatch(
        /^jest project "web": jest 29\.7\.0 at .* is incomplete: .*jest-runtime/,
      );
    }
  });

  it("finds a package whose exports hide its package.json", () => {
    const root = tree({
      ...jestTree("30.5.2", ["jest-runtime"]),
      ...pkg("jest-runtime", "30.5.2", { exports: { ".": "./index.js" } }),
    });
    const resolution = resolveJest("web", root, root);
    if (!resolution.ok) throw new Error(resolution.note);
    expect(resolution.install.runtime).toBe(join(root, "node_modules/jest-runtime"));
  });
});

describe("tsNodeHygiene (spec 028 D2.2, research 028-01 F1.4)", () => {
  const config = (root: string, at = "packages/web/jest.config.ts") =>
    join(root, at) as AbsolutePath;

  it("takes the nearest tsconfig, tsconfig.spec.json before tsconfig.json before tsconfig.base.json", () => {
    const root = tree({
      "tsconfig.base.json": "{}",
      "packages/web/tsconfig.json": "{}",
      "packages/web/tsconfig.spec.json": "{}",
    });
    expect(tsNodeHygiene(29, config(root), root, {})).toEqual({
      TS_NODE_PROJECT: join(root, "packages/web/tsconfig.spec.json"),
    });
  });

  it("walks up to the worktree root's tsconfig.base.json", () => {
    const root = tree({ "tsconfig.base.json": "{}", "packages/web/jest.config.ts": "" });
    expect(tsNodeHygiene(29, config(root), root, {})).toEqual({
      TS_NODE_PROJECT: join(root, "tsconfig.base.json"),
    });
  });

  it("skips ts-node's project lookup when the only tsconfig is above the worktree root", () => {
    const outer = tree({ "tsconfig.json": "{}" });
    const root = join(outer, "worktree") as AbsolutePath;
    mkdirSync(root);
    expect(tsNodeHygiene(29, config(root), root, {})).toEqual({ TS_NODE_SKIP_PROJECT: "true" });
  });

  it("changes nothing on Jest 30, for a JavaScript config, or with TS_NODE_PROJECT set", () => {
    const root = tree({ "tsconfig.json": "{}" });
    expect(tsNodeHygiene(30, config(root), root, {})).toEqual({});
    expect(tsNodeHygiene(29, config(root, "jest.config.js"), root, {})).toEqual({});
    expect(tsNodeHygiene(29, config(root), root, { TS_NODE_PROJECT: "own.json" })).toEqual({});
  });
});
