import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { COVERAGE_RUNTIME, REPO_ROOT, rootVersion } from "../../../src/harness/build.js";
import {
  notePiCommand,
  PI_PLUGIN_DIR,
  PI_PLUGIN_DIST,
  PI_SKILL,
  PI_SKILL_NOTE,
  SKILL_SOURCE,
} from "../../../src/harness/pi/build.js";
import { tempDir } from "../../store/helpers.js";
import { expectSameFiles } from "../bundle-helpers.js";
import { buildPiBundles } from "./helpers.js";

/*
 * Spec 009 D1: `plugins/pi/` is a Pi package whose manifest declares the ESM
 * extension explicitly (Pi's directory scan ignores a bare `.mjs`), names
 * Pi's host packages as peers and carries the root version, with the skill
 * copied from the Claude Code plugin and `dist/` committed as built.
 */

let built = { dir: "", cleanup: () => {} };
beforeAll(async () => {
  built = await buildPiBundles();
}, 60_000);
afterAll(() => built.cleanup());

/** The skill as the Pi copy must hold it: its source with the Pi note. */
function expectedSkill(): string {
  const dir = join(tempDir("squeal-pi-skill-"), "squeal");
  cpSync(join(REPO_ROOT, SKILL_SOURCE), dir, { recursive: true });
  notePiCommand(dir);
  return dir;
}

describe("the Pi package", () => {
  it("declares the extension and the skills, Pi as a peer, and the root version", () => {
    const manifest = JSON.parse(readFileSync(join(PI_PLUGIN_DIR, "package.json"), "utf8"));
    expect(manifest).toMatchObject({
      version: rootVersion(),
      type: "module",
      pi: { extensions: ["./dist/extension.mjs"], skills: ["./skills"] },
      peerDependencies: { "@earendil-works/pi-coding-agent": "*" },
    });
    expect(manifest.dependencies).toBeUndefined();
  });

  it("has the bundles exactly as `npm run build:plugin` produces them", () => {
    expectSameFiles(PI_PLUGIN_DIST, built.dir, ".mjs");
  });

  it("carries the skill exactly as its source in the Claude Code plugin, with the Pi note", () => {
    expectSameFiles(join(PI_PLUGIN_DIR, PI_SKILL), expectedSkill());
    const source = readFileSync(join(REPO_ROOT, SKILL_SOURCE, "SKILL.md"), "utf8");
    const copy = readFileSync(join(PI_PLUGIN_DIR, PI_SKILL, "SKILL.md"), "utf8");
    expect(copy).toBe(source.replace("# Squeal\n", `# Squeal\n\n${PI_SKILL_NOTE}\n`));
  });

  it("ships the coverage provider Vitest loads by path in dist/coverage/ (015-11)", () => {
    expect(readFileSync(join(built.dir, "coverage", "provider.mjs"), "utf8")).toBe(
      readFileSync(join(REPO_ROOT, COVERAGE_RUNTIME, "provider.mjs"), "utf8"),
    );
  });

  it("bundles an extension that imports only Node built-ins", () => {
    const imports = [
      ...readFileSync(join(built.dir, "extension.mjs"), "utf8").matchAll(/from "([^"]+)"/g),
    ].map((m) => m[1]);
    expect(imports.length).toBeGreaterThan(0);
    for (const from of imports) expect(from).toMatch(/^node:/);
  });
});
