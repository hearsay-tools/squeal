import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  environmentHash,
  KEY_FORMAT_VERSION,
  KEY_SOURCES_HASHES,
} from "../../src/core/keys/index.js";
import type { CoreEnvironmentInputs, RunnerEnvironment } from "../../src/core/types/index.js";
import {
  bundledDependencies,
  EXEMPT,
  GUARDED_WITHIN,
  guardedFiles,
  guardedImportsOfExempt,
  keySourcesHash,
  type Overlay,
  ROOT,
} from "./key-sources.js";

const PIN = "src/core/keys/key-format.ts";
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

/** The real tree with `path`'s text edited by `edit`, which must change it. */
function edited(path: string, edit: (text: string) => string): Overlay {
  const before = read(path);
  const after = edit(before);
  expect(after, `the edit of ${path} no longer applies`).not.toBe(before);
  return { [path]: after };
}

const replaced = (path: string, from: string, to: string) =>
  edited(path, (text) => text.replace(from, to));

describe("KEY_FORMAT_VERSION", () => {
  it("is bumped whenever the guarded sources change", () => {
    const current = keySourcesHash();
    expect(
      KEY_SOURCES_HASHES[KEY_FORMAT_VERSION],
      `the guarded sources changed: bump KEY_FORMAT_VERSION in ${PIN} ` +
        `and pin "${current}" under the new version in KEY_SOURCES_HASHES`,
    ).toBe(current);
  });

  it("pins one distinct hash per version, 1 to the current one", () => {
    const versions = Object.keys(KEY_SOURCES_HASHES).map(Number);
    expect(versions).toEqual(Array.from({ length: KEY_FORMAT_VERSION }, (_, i) => i + 1));
    expect(new Set(Object.values(KEY_SOURCES_HASHES)).size).toBe(versions.length);
  });
});

describe("the guard", () => {
  const pinned = keySourcesHash();

  // Review wave 13m, B1: a predecessor without the completion barrier passed the guard.
  it.each([
    [
      "the completion barrier",
      "src/core/scheduler/stability.ts",
      "if (touched.length === 0) return report;",
      "if (touched.length >= 0) return report;",
    ],
    [
      "recordsForFile",
      "src/core/scheduler/records.ts",
      "      outcome: result.outcome,\n",
      '      outcome: "pass",\n',
    ],
    [
      "recordTier",
      "src/core/scheduler/tiers.ts",
      'report.end === "completed";',
      'report.end !== "completed";',
    ],
    ["the slow artifact rule", "src/core/slow/inherit.ts", "export", "export /* */"],
    ["the daemon's entry", "src/cli/daemon.ts", "ownsProcess: true", "ownsProcess: false"],
    ["the build", "src/harness/build.ts", 'target: "node22.13"', 'target: "node24"'],
    ["the bundler's options", "tsconfig.json", '"strict": true', '"strict": false'],
  ])("fails on a change to %s", (_, path, from, to) => {
    expect(keySourcesHash(ROOT, replaced(path, from, to))).not.toBe(pinned);
  });

  it("fails on a new source, a deleted one and a rename", () => {
    const moved = "src/core/scheduler/stability.ts";
    expect(keySourcesHash(ROOT, { "src/core/state/new.ts": "export {};\n" })).not.toBe(pinned);
    expect(keySourcesHash(ROOT, { [moved]: null })).not.toBe(pinned);
    const renamed = { [moved]: null, "src/core/scheduler/barrier.ts": read(moved) };
    expect(keySourcesHash(ROOT, renamed)).not.toBe(pinned);
  });

  it("holds on a change to an exempt file, a new one included, and on CRLF line endings", () => {
    for (const path of [
      "src/core/status/format-status.ts",
      "src/core/delivery/format.ts",
      "src/cli/status-wait-lines.ts",
      "src/harness/shared/text.ts",
      PIN,
    ]) {
      expect(
        keySourcesHash(
          ROOT,
          edited(path, (text) => `${text}// note\n`),
        ),
        path,
      ).toBe(pinned);
    }
    expect(keySourcesHash(ROOT, { "src/core/status/new.ts": "export {};\n" })).toBe(pinned);
    const crlf = edited("src/core/keys/environment.ts", (text) => text.replaceAll("\n", "\r\n"));
    expect(keySourcesHash(ROOT, crlf)).toBe(pinned);
  });

  it("holds on a version-only package.json change, in the root and the plugin", () => {
    const bump = (text: string) => text.replace(/"version": "[^"]+"/, '"version": "9.9.9"');
    expect(keySourcesHash(ROOT, edited("package.json", bump))).toBe(pinned);
    expect(keySourcesHash(ROOT, edited("plugins/claude-code/package.json", bump))).toBe(pinned);
    const lock = edited("package-lock.json", (text) =>
      text.replace(
        /"name": "squeal",\n(\s*)"version": "[^"]+"/g,
        '"name": "squeal",\n$1"version": "9.9.9"',
      ),
    );
    expect(keySourcesHash(ROOT, lock)).toBe(pinned);
  });

  it("fails on a bundled dependency's lock entry, a transitive one included, and holds on a tool's", () => {
    const entry = (location: string, field: string, value: string) =>
      edited("package-lock.json", (text) => {
        const lock = JSON.parse(text) as { packages: Record<string, Record<string, unknown>> };
        lock.packages[location] = { ...lock.packages[location], [field]: value };
        return `${JSON.stringify(lock, null, 2)}\n`;
      });
    expect(
      keySourcesHash(ROOT, entry("node_modules/enhanced-resolve", "version", "5.99.0")),
    ).not.toBe(pinned);
    expect(keySourcesHash(ROOT, entry("node_modules/tapable", "integrity", "sha512-x"))).not.toBe(
      pinned,
    );
    expect(keySourcesHash(ROOT, entry("node_modules/esbuild", "version", "0.99.0"))).not.toBe(
      pinned,
    );
    expect(keySourcesHash(ROOT, entry("node_modules/@biomejs/biome", "version", "9.0.0"))).toBe(
      pinned,
    );
  });

  it("fingerprints what the bundles embed, never the build's externals or the root", () => {
    const locations = bundledDependencies(read("package-lock.json")).map((line) =>
      line.slice(0, line.lastIndexOf("@")),
    );
    for (const name of ["acorn", "chokidar", "enhanced-resolve", "es-module-lexer", "tapable"]) {
      expect(locations).toContain(`node_modules/${name}`);
    }
    expect(locations).toContain("node_modules/esbuild");
    for (const name of ["vitest", "@parcel/watcher", "@biomejs/biome", "typescript", ""]) {
      expect(locations).not.toContain(name === "" ? "" : `node_modules/${name}`);
    }
  });

  it("names a reason for every exemption, and each names a path that exists", () => {
    for (const [path, reason] of Object.entries({ ...EXEMPT, ...GUARDED_WITHIN })) {
      expect(reason.length, path).toBeGreaterThan(10);
      expect(existsSync(join(ROOT, path)), path).toBe(true);
    }
    expect(guardedFiles()).toEqual(expect.arrayContaining(Object.keys(GUARDED_WITHIN)));
  });

  // An exempt file stays exempt only while no guarded file needs it to key, run or record.
  it("lets guarded sources import exempt ones only through these named seams", () => {
    expect(guardedImportsOfExempt()).toEqual([
      // Whether a daemon is alive, to start one: never what it stores.
      "src/core/daemon/ensure.ts -> src/core/delivery/liveness.ts",
      // Consumer expiry and departed harnesses.
      "src/core/daemon/lifecycle.ts -> src/core/delivery/index.ts",
      // The format version, which every environment hash holds directly.
      "src/core/keys/environment.ts -> src/core/keys/key-format.ts",
      "src/core/keys/index.ts -> src/core/keys/key-format.ts",
      // Whether a consumer is in a turn decides when the slow tier runs, not what it records.
      "src/core/scheduler/slow-tier.ts -> src/core/delivery/turn.ts",
      "src/core/state/slow.ts -> src/core/delivery/slots.ts",
      // The adapters' own versions (D4).
      "src/runners/node-test/adapter.ts -> src/runners/node-test/version.ts",
      "src/runners/vitest/adapter.ts -> src/runners/vitest/version.ts",
      "src/runners/vitest/index.ts -> src/runners/vitest/version.ts",
    ]);
  });
});

// Review wave 13m, S1: an adapter bump alone re-keys its own runner and passes the guard.
describe("an adapter-only bump", () => {
  const VERSIONS = {
    vitest: ["src/runners/vitest/version.ts", "VITEST_ADAPTER_VERSION"],
    "node:test": ["src/runners/node-test/version.ts", "NODE_TEST_ADAPTER_VERSION"],
  } as const;

  it.each(Object.values(VERSIONS))("of %s keeps the global pin", (path, name) => {
    const bump = replaced(path, `${name} = "`, `${name} = "1`);
    expect(keySourcesHash(ROOT, bump)).toBe(KEY_SOURCES_HASHES[KEY_FORMAT_VERSION]);
  });

  it.each(Object.values(VERSIONS))("%s holds that constant and nothing else", (path, name) => {
    const code = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    expect(code).toMatch(new RegExp(`^export const ${name} = "\\d+";$`));
  });

  it("moves only that runner's keys", () => {
    // No runner's code names another's version, so only its own environments carry it.
    for (const [path, name] of Object.values(VERSIONS)) {
      const own = path.replace("version.ts", "");
      for (const other of guardedFiles().filter((p) => p.startsWith("src/runners/"))) {
        if (!other.startsWith(own)) expect(read(other).includes(name), other).toBe(false);
      }
    }
    const core: CoreEnvironmentInputs = {
      squealVersion: "0.1.0",
      nodeVersion: "v24.21.0",
      platform: "linux",
      arch: "x64",
      installedDependencies: "deps",
      env: {},
    };
    const environment = (runnerName: string, adapterVersion: string): RunnerEnvironment => ({
      project: runnerName,
      runnerName,
      runnerVersion: "1",
      adapterVersion,
      resolvedConfig: "{}",
      files: [],
    });
    const keys = (vitest: string) => [
      environmentHash(core, environment("vitest", vitest), () => null),
      environmentHash(core, environment("node:test", "9"), () => null),
    ];
    const [vitestBefore, nodeBefore] = keys("2");
    const [vitestAfter, nodeAfter] = keys("3");
    expect(vitestAfter).not.toBe(vitestBefore);
    expect(nodeAfter).toBe(nodeBefore);
  });
});
