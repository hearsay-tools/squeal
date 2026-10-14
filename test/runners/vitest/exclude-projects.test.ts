import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TestFileRef } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, outcomes, SLOW } from "./helpers.js";

/*
 * Spec 001 D11 (task 001-349): `vitest.excludeProjects`. The fixture is
 * cezar's shape: four inline projects its `npm test` selects and `e2e`, from
 * its own config file, that only `npm run test:e2e` can boot.
 */

const FOUR: TestFileRef[] = [
  { project: "api-client", path: "test/api-client.test.ts" },
  { project: "contract", path: "test/contract.test.ts" },
  { project: "server", path: "test/server.test.ts" },
  { project: "web", path: "test/web.test.ts" },
];
const E2E: TestFileRef = { project: "e2e", path: "e2e/app.e2e.test.ts" };
const FIVE = [...FOUR, E2E].sort((a, b) => a.project.localeCompare(b.project));

/** The fixture, with `exclude()` read as the policy at each instance start. */
async function open(exclude: () => readonly string[]) {
  const notes: string[] = [];
  const fx = await openFixture("five-projects", {}, (root) =>
    createVitestAdapter({ root, note: (text) => notes.push(text), excludeProjects: exclude }),
  );
  return { fx, notes };
}

const sorted = (refs: readonly TestFileRef[]) =>
  [...refs].sort((a, b) => a.project.localeCompare(b.project));

describe("vitest.excludeProjects (001 D11, task 001-349)", () => {
  it("runs four of five projects and never creates the excluded one", SLOW, async () => {
    const { fx, notes } = await open(() => ["e2e"]);
    expect(sorted(await fx.adapter.testFiles())).toEqual(FOUR);
    const env = await fx.adapter.environment();
    expect(env.map((e) => e.project).sort()).toEqual(["api-client", "contract", "server", "web"]);
    const report = await fx.adapter.run(FOUR, fx.runOptions());
    expect(outcomes(report)).toEqual(["pass", "pass", "pass", "pass"]);
    expect(existsSync(join(fx.root, "e2e/booted"))).toBe(false);
    expect(notes).toEqual([]);
  });

  it("reports a name no project has once, and applies the rest of the list", SLOW, async () => {
    const { fx, notes } = await open(() => ["e2e", "nope"]);
    expect(sorted(await fx.adapter.testFiles())).toEqual(FOUR);
    expect(notes).toEqual([
      `squeal.config.json: "vitest.excludeProjects[1]" names no Vitest project ("nope"); it is left out`,
    ]);
  });

  it("runs all five without the key", SLOW, async () => {
    const { fx, notes } = await open(() => []);
    expect(sorted(await fx.adapter.testFiles())).toEqual(FIVE);
    const report = await fx.adapter.run([E2E], fx.runOptions());
    expect(outcomes(report)).toEqual(["pass"]);
    expect(existsSync(join(fx.root, "e2e/booted"))).toBe(true);
    expect(notes).toEqual([]);
  });

  it("takes an edit of the key mid-session at the policy file's revision", SLOW, async () => {
    let excluded: readonly string[] = [];
    const { fx } = await open(() => excluded);
    expect(sorted(await fx.adapter.testFiles())).toEqual(FIVE);
    const server = async () => (await fx.adapter.environment()).find((e) => e.project === "server");
    const before = await server();

    excluded = ["e2e"];
    const narrowed = await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect(narrowed.recreatedProjects).toContain("e2e");
    expect(sorted(await fx.adapter.testFiles())).toEqual(FOUR);
    // The filter never reaches the config tests receive. The environment
    // loses e2e's config file and its packages (every project's config is an
    // input of each, D3), so the other projects re-key once.
    expect((await server())?.resolvedConfig).toEqual(before?.resolvedConfig);

    excluded = [];
    const widened = await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect(widened.recreatedProjects).toContain("e2e");
    expect(sorted(await fx.adapter.testFiles())).toEqual(FIVE);

    // A revision that leaves the list as it was recreates nothing.
    const same = await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect(same.recreatedProjects).toEqual([]);
  });
});
