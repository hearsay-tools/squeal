import { describe, expect, it } from "vitest";
import { type ConfigSet, readConfigs } from "../../../src/core/lint/provider/oxlint/config-set.js";
import { chainOf, type FolderConfigs } from "../../../src/core/lint/provider/oxlint/configs.js";
import { discoverOxlint } from "../../../src/core/lint/provider/oxlint/discover.js";
import { Preload } from "../../../src/core/lint/provider/oxlint/preload.js";
import { YIELD_EVERY } from "../../../src/core/lint/provider/oxlint/provider.js";
import {
  chunkDebugPaths,
  lintedFiles,
  type RunContext,
} from "../../../src/core/lint/provider/oxlint/run.js";
import type { AbsolutePath, RelativePath } from "../../../src/core/types/common.js";
import { project, provider, write } from "./helpers.js";

/*
 * Row 017-35 (issue #274 F3.1, F3.3, F3.5): `--debug files` parts bounded by
 * command-line bytes, the config chain memoized per `inputs` call, and
 * `inputs` yielding to the event loop. Keys and linted sets stay the same.
 */

const p = (path: string) => path as RelativePath;
const bytes = (part: readonly string[]) =>
  part.reduce((sum, path) => sum + Buffer.byteLength(path, "utf8") + 1, 0);

/** A project with nested configs, folders without one, an ignored folder and `count` files. */
function nested(count: number): { root: AbsolutePath; paths: RelativePath[] } {
  const files: Record<string, string> = {
    ".oxlintrc.json": JSON.stringify({ ignorePatterns: ["gen/**"], rules: { eqeqeq: "error" } }),
    "pkg/.oxlintrc.json": JSON.stringify({ rules: { "no-debugger": "error" } }),
    "pkg/deep/er/x.ts": "export const x = 1;\n",
    "gen/g.ts": "export const g = 1;\n",
    "src/ünï/çødé.ts": "export const u = 1;\n",
    "README.md": "# r\n",
  };
  const dirs = ["src", "src/a/b", "pkg", "pkg/deep", "lib/c"];
  for (let i = 0; i < count; i++) {
    files[`${dirs[i % dirs.length]}/f${String(i).padStart(4, "0")}.ts`] =
      `export const v${i} = ${i};\n`;
  }
  return { root: project(files), paths: Object.keys(files).sort().map(p) };
}

function context(root: AbsolutePath): RunContext {
  const install = discoverOxlint(root);
  if ("off" in install) throw new Error(install.off);
  return {
    root,
    node: process.execPath,
    install,
    preload: new Preload(),
    observe: true,
    format: "sha1",
    env: { PATH: process.env.PATH },
    guardMs: 30_000,
    signal: new AbortController().signal,
  };
}

async function configSet(ctx: RunContext): Promise<ConfigSet> {
  const read = await readConfigs(ctx, () => null);
  if ("off" in read) throw new Error(read.reason);
  return read;
}

describe("byte-bounded --debug files parts", () => {
  const paths = Array.from({ length: 8000 }, (_, i) => p(`src/folder-${i % 7}/file-${i}.ts`));

  it.each([
    ["POSIX", 128 * 1024],
    ["win32", 24 * 1024],
  ])("keeps each %s part under its bound and names every path once, in order", (_, max) => {
    const parts = chunkDebugPaths(paths, max);
    expect(parts.length).toBeGreaterThan(1);
    for (const part of parts) expect(bytes(part)).toBeLessThanOrEqual(max);
    // Each part is full: the next path would have crossed the bound.
    for (let i = 0; i + 1 < parts.length; i++) {
      expect(bytes(parts[i] ?? []) + bytes([parts[i + 1]?.[0] ?? ""])).toBeGreaterThan(max);
    }
    expect(parts.flat()).toEqual(paths);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const wide = [p("ü"), p("ü"), p("ü")]; // 2 bytes + 1 separator each
    expect(chunkDebugPaths(wide, 6)).toEqual([[p("ü"), p("ü")], [p("ü")]]);
  });

  it("gives a path longer than the bound a part of its own", () => {
    const long = p(`${"x".repeat(100)}.ts`);
    expect(chunkDebugPaths([p("a.ts"), long, p("b.ts")], 50)).toEqual([
      [p("a.ts")],
      [long],
      [p("b.ts")],
    ]);
    expect(chunkDebugPaths([], 50)).toEqual([]);
  });
});

describe("real oxlint with byte-bounded parts", { timeout: 120_000 }, () => {
  it("lists the same linted set in one part and in many", async () => {
    const { root, paths } = nested(300);
    const ctx = context(root);
    try {
      const one = await lintedFiles(ctx, paths);
      const many = await lintedFiles(ctx, paths, 1024);
      if ("failure" in one || "failure" in many) throw new Error("a --debug files run failed");
      expect(chunkDebugPaths(paths, 1024).length).toBeGreaterThanOrEqual(5);
      expect([...many].sort()).toEqual([...one].sort());
      expect(one.has(p("gen/g.ts"))).toBe(false);
      expect(one.has(p("src/ünï/çødé.ts"))).toBe(true);
      expect(one.size).toBe(paths.filter((path) => path.endsWith(".ts")).length - 1);
    } finally {
      ctx.preload.remove();
    }
  });
});

describe("the memoized config chain", { timeout: 60_000 }, () => {
  it("is byte-identical to the disk chain across nested configs and folders without one", async () => {
    const { root, paths } = nested(40);
    const folders: FolderConfigs = new Map();
    for (const path of paths) {
      expect(JSON.stringify(chainOf(root, path, folders))).toBe(
        JSON.stringify(chainOf(root, path)),
      );
    }
    expect(folders.get("pkg/deep/er")).toBeNull();
    expect(folders.get("pkg")).toBe("pkg/.oxlintrc.json");
    expect(folders.has("src/a")).toBe(true);
    const ctx = context(root);
    try {
      const set = await configSet(ctx);
      const memo: FolderConfigs = new Map();
      for (const path of paths) expect(set.inputsOf(path, memo)).toBe(set.inputsOf(path));
    } finally {
      ctx.preload.remove();
    }
  });

  it("leaves missed() reading the disk for a config made after the read", async () => {
    const { root } = nested(5);
    const ctx = context(root);
    try {
      const set = await configSet(ctx);
      const memo: FolderConfigs = new Map();
      const file = p("lib/c/f0004.ts");
      const before = set.inputsOf(file, memo);
      expect(set.missed(file)).toBe(false);
      write(root, { "lib/.oxlintrc.json": "{}" });
      expect(set.missed(file)).toBe(true);
      // The memo is one call's: it still answers what that call read.
      expect(set.inputsOf(file, memo)).toBe(before);
      expect(set.inputsOf(file)).not.toBe(before);
    } finally {
      ctx.preload.remove();
    }
  });
});

describe("Provider.inputs yields", { timeout: 120_000 }, () => {
  it("lets the event loop run between parts of a batch over 600 files", async () => {
    const { root, paths } = nested(700);
    const lint = provider(root, { guardMs: 30_000 });
    await lint.open();
    const configs = (lint as unknown as { configs: ConfigSet }).configs;
    const inputsOf = configs.inputsOf.bind(configs);
    let ticks = 0;
    let ticking = true;
    const tick = () => {
      ticks += 1;
      if (ticking) setImmediate(tick);
    };
    const seen: number[] = [];
    (configs as { inputsOf: ConfigSet["inputsOf"] }).inputsOf = (path, folders) => {
      seen.push(ticks);
      return inputsOf(path, folders);
    };
    setImmediate(tick);
    const inputs = await lint.inputs(paths);
    ticking = false;
    expect(inputs.size).toBeGreaterThan(600);
    expect(inputs.size).toBe(seen.length);
    // A block of up to YIELD_EVERY paths sees one tick; the event loop ran between blocks.
    const distinct = new Set(seen).size;
    expect(distinct).toBeGreaterThanOrEqual(Math.floor(paths.length / YIELD_EVERY));
    expect(inputs.get(p("pkg/deep/er/x.ts"))?.config).toBe(
      JSON.stringify({ chain: chainOf(root, p("pkg/deep/er/x.ts")) }),
    );
  });
});
