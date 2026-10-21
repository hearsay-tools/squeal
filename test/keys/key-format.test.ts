import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { environmentHash, KEY_FORMAT_VERSION } from "../../src/core/keys/index.js";
import type { CoreEnvironmentInputs, RunnerEnvironment } from "../../src/core/types/index.js";
import { CASES } from "./validity/cases/index.js";
import { failures } from "./validity/compare.js";
import { COMPONENTS, GLOBAL, versionName } from "./validity/components.js";
// The validity path's entries and the harness, statically: esbuild reads them in a process no
// recorder sees (011 C12), so this import is what re-runs this file when one of them changes.
import "./validity/driver.js";
import { comparisons, edited, read, SLOW } from "./validity/self-test.js";
import { ROOT, versionOf } from "./validity/trees.js";

/*
 * The alarm (011 C3, C12 and C14 as amended 2026-10-20, task 011-37
 * sections 2 and 6, row 011-41), in place of the guard of task 001-203:
 * `KEY_FORMAT_VERSION`, each adapter's version and `RECORDER_VERSION` move
 * only when the validity path's outputs differ from the last release's. A
 * release whose emitted code on the path is the last one's runs no case and
 * keeps every version; one whose code moved keeps them while every case
 * agrees and every changed line ran; a raise needs a case whose outputs
 * differ, and a raised format reads no earlier one as its own.
 */

const { compare, release, tree } = comparisons();

describe("KEY_FORMAT_VERSION", SLOW, () => {
  it("moves only when the validity path's outputs differ from the last release's", async () => {
    const result = await compare({}, CASES, tree());
    expect(failures(result, release())).toEqual([]);
  });

  it("names a version in its own file, which each component's entries pin", () => {
    for (const component of COMPONENTS) {
      expect(versionOf(ROOT, component), versionName(component)).toMatch(/^\d+$/);
    }
    expect(versionOf(ROOT, GLOBAL)).toBe(String(KEY_FORMAT_VERSION));
  });
});

// Review wave 13m, S1: an adapter bump alone re-keys its own runner, and moves no other version.
describe("an adapter-only bump", () => {
  const VERSIONS = {
    vitest: ["src/runners/vitest/version.ts", "VITEST_ADAPTER_VERSION"],
    "node:test": ["src/runners/node-test/version.ts", "NODE_TEST_ADAPTER_VERSION"],
    pytest: ["src/runners/pytest/version.ts", "PYTEST_ADAPTER_VERSION"],
  } as const;

  it.each(Object.entries(VERSIONS))(
    "of %s fires no alarm, and fails its own verdict alone for want of a differing case (D6)",
    async (name, [path, constant]) => {
      const bump = edited(path, `${constant} = "`, `${constant} = "1`);
      const result = await compare(bump, []);
      expect(result.fired).toBe(false);
      expect(failures(result, release())).toEqual([
        expect.stringMatching(
          new RegExp(
            `^${constant} .* moved from \\d+ at .* a raise needs a case whose outputs differ`,
          ),
        ),
      ]);
      const moved = result.alarms.filter((a) => a.versions.baseline !== a.versions.candidate);
      expect(moved.map((a) => a.component.name)).toEqual([name]);
    },
    SLOW.timeout,
  );

  it.each(Object.values(VERSIONS))("%s holds that constant and nothing else", (path, name) => {
    const code = read(path)
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .trim();
    expect(code).toMatch(new RegExp(`^export const ${name} = "\\d+";$`));
  });

  it("moves only that runner's keys", () => {
    // No runner's code names another's version, so only its own environments carry it.
    const runners = readdirSync(join(ROOT, "src/runners"), { recursive: true, encoding: "utf8" })
      .filter((path) => /\.(ts|cjs|mjs)$/.test(path))
      .map((path) => `src/runners/${path.split("\\").join("/")}`);
    for (const [path, name] of Object.values(VERSIONS)) {
      const own = path.replace("version.ts", "");
      for (const other of runners.filter((p) => !p.startsWith(own))) {
        expect(read(other).includes(name), other).toBe(false);
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

describe("the alarm", SLOW, () => {
  // 011-86: the build's target is `node` and engines.node's floor.
  const ENGINES = /"node": ">=[^"]+"/;
  const engines = read("package.json").match(ENGINES)?.[0] ?? '"node"';

  it("fires on a change to the build's target, engines.node, which the shipped bundles are built at", async () => {
    const result = await compare(edited("package.json", engines, '"node": ">=16.0"'), []);
    expect(result.alarms.filter((a) => a.fired).map((a) => a.component.name)).toEqual(
      COMPONENTS.map((c) => c.name),
    );
  });

  it("fires on no other change to package.json: its version, its description", async () => {
    const version = read("package.json").match(/"version": "[^"]+"/)?.[0] ?? '"version"';
    const manifest = edited("package.json", version, '"version": "9.9.9"');
    const result = await compare(
      {
        "package.json": (manifest["package.json"] ?? "").replace(
          /"description": "[^"]+"/,
          '"description": "another"',
        ),
      },
      [],
    );
    expect(result.alarms.filter((a) => a.fired)).toEqual([]);
  });

  it("fires on no change outside the entries: status, delivery, the CLI and the harnesses", async () => {
    const note = (path: string) => ({ [path]: `${read(path)}export const note = 1;\n` });
    const result = await compare(
      {
        ...note("src/core/status/format-status.ts"),
        ...note("src/core/delivery/format.ts"),
        ...note("src/cli/status-wait-lines.ts"),
        ...note("src/harness/shared/text.ts"),
      },
      [],
    );
    expect(result.fired).toBe(false);
    expect(failures(result, release())).toEqual([]);
  });
});
