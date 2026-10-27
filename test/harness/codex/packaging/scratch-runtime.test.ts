import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { REPO_ROOT } from "../../../../src/harness/build.js";
import {
  CODEX_DESCRIPTION,
  CODEX_MANIFEST,
  CODEX_SETUP_SKILL,
  CODEX_SKILL,
  runtimeNodeFloor,
  SETUP_SKILL_SOURCE,
} from "../../../../src/harness/codex/build.js";
import {
  createRuntimeManifest,
  REQUIRED_ENTRIES,
  serializeRuntimeManifest,
  validateRuntimeTree,
} from "../../../../src/harness/codex/runtime-release/index.js";
import { expectSameFiles } from "../../bundle-helpers.js";
import { A, expectedSkill, runtimeAt, scratch, snapshotTree } from "./fixture.js";

/*
 * Spec 002 D8 (row 002-31): the current runtime, built into a scratch
 * directory at a version of its own, is a complete runtime tree whose
 * `runtime.json` is the one the build would write again, and a second build
 * is the same bytes.
 */

const SLOW = { timeout: 120_000 } as const;

describe("a runtime built into a scratch directory", () => {
  // Kept for the whole describe: `tempDir` removes its directory after each test.
  const tmp = scratch("sq-codex-runtime-");
  const root = tmp.dir;
  afterAll(() => tmp.cleanup());
  beforeAll(async () => {
    mkdirSync(join(root, "dist", "stale"), { recursive: true });
    writeFileSync(join(root, "dist", "stale", "old.mjs"), "removed by the build\n");
    mkdirSync(join(root, CODEX_SKILL), { recursive: true });
    writeFileSync(join(root, CODEX_SKILL, "stale.md"), "removed by the copy\n");
    await runtimeAt(root, A);
  }, 120_000);

  it("writes the manifest at its version, the skills and the bundles, nothing stale", () => {
    expect(JSON.parse(readFileSync(join(root, CODEX_MANIFEST), "utf8"))).toEqual({
      name: "squeal",
      version: A,
      description: CODEX_DESCRIPTION,
    });
    expectSameFiles(join(root, CODEX_SKILL), expectedSkill());
    expectSameFiles(join(root, CODEX_SETUP_SKILL), join(REPO_ROOT, SETUP_SKILL_SOURCE));
    expect(existsSync(join(root, "dist", "stale"))).toBe(false);
    expect(readFileSync(join(root, "dist", "cli", "squeal.mjs"), "utf8")).toContain(`"${A}"`);
  });

  it("lists every file in a canonical runtime.json with the 22.19.0 floor, every required entry", () => {
    const manifest = validateRuntimeTree(root, { expectedVersion: A });
    expect(manifest.nodeFloor).toBe("22.19.0");
    expect(runtimeNodeFloor()).toBe("22.19.0");
    for (const entry of REQUIRED_ENTRIES) expect(manifest.files[entry], entry).toBeDefined();
    expect(manifest.files["bin/squeal-launcher"]?.mode).toBe(0o755);
  });

  it("round-trips its manifest: recreated from the tree, it serializes to the same bytes", () => {
    const text = readFileSync(join(root, "runtime.json"), "utf8");
    const again = createRuntimeManifest({ root, version: A, nodeFloor: runtimeNodeFloor() });
    expect(serializeRuntimeManifest(again)).toBe(text);
  });

  it(
    "is reproducible: a second build of the same version is the same bytes and modes",
    SLOW,
    async () => {
      const again = join(tmp.dir, "..", `${basename(tmp.dir)}-again`);
      try {
        await runtimeAt(again, A);
        expect(snapshotTree(again)).toEqual(snapshotTree(root));
      } finally {
        rmSync(again, { recursive: true, force: true });
      }
    },
  );
});
