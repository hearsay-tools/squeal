import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { environmentHash } from "../../../src/core/keys/environment.js";
import type { RunnerEnvironment } from "../../../src/core/types/index.js";
import { createVitestAdapter } from "../../../src/runners/vitest/index.js";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Review wave-13bl B1 and the coordinator's break (task 001-370): a config's
 * own `test.project` filter. The key may only narrow what Vitest runs, and
 * the unknown-name check sees every project, the filter cleared. The config
 * is the reviewer's reproduction: three inline projects over one file.
 */

const threeProjects = (filter: readonly string[] | undefined) => `export default {
  test: {
    ${filter === undefined ? "" : `project: ${JSON.stringify(filter)},`}
    projects: ["a", "b", "c"].map((name) => ({ test: { name, include: ["test/server.test.ts"] } })),
  },
};
`;

async function open(filter: readonly string[] | undefined, excluded: readonly string[]) {
  const notes: string[] = [];
  const fx = await openFixture(
    "five-projects",
    { "vitest.config.ts": threeProjects(filter) },
    (root) =>
      createVitestAdapter({
        root,
        note: (text) => notes.push(text),
        excludeProjects: () => excluded,
      }),
  );
  const projects = (await fx.adapter.testFiles()).map((ref) => ref.project).sort();
  return { fx, notes, projects };
}

describe("vitest.excludeProjects under a config's own project filter (001-370)", () => {
  it.each([
    [["a"], ["b"], ["a"]],
    [["!c"], ["b"], ["a"]],
    [["a", "b"], ["b"], ["a"]],
    [["!c"], ["a"], ["b"]],
  ])("config filter %j with %j excluded runs %j", SLOW, async (filter, excluded, runs) => {
    const { notes, projects } = await open(filter, excluded);
    expect(projects).toEqual(runs);
    expect(notes).toEqual([]);
  });

  it.each([
    [["a"], ["a"]],
    [["!c"], ["a", "b"]],
  ])("config filter %j alone runs %j, as before the key", SLOW, async (filter, runs) => {
    const { notes, projects } = await open(filter, []);
    expect(projects).toEqual(runs);
    expect(notes).toEqual([]);
  });

  it(
    "knows a project the config's filter drops, and still reports a name no project has",
    SLOW,
    async () => {
      // `c` exists though `!c` drops it; `C*` matches it as a selector; `nope` matches nothing.
      const { notes, projects } = await open(["!c"], ["c", "C*", "nope"]);
      expect(projects).toEqual(["a", "b"]);
      expect(notes).toEqual([
        `squeal.config.json: "vitest.excludeProjects[2]" names no Vitest project ("nope"); it is left out`,
      ]);
    },
  );
});

/** The environment hash `keying.ts` takes, with fixed core inputs and the fixture's own bytes. */
function digest(root: string, env: RunnerEnvironment | undefined): string {
  if (env === undefined) throw new Error("no environment");
  const core = {
    squealVersion: "0",
    nodeVersion: "0",
    platform: "p",
    arch: "a",
    installedDependencies: "",
    env: {},
  };
  return environmentHash(core, env, (path) => {
    try {
      return createHash("sha256")
        .update(readFileSync(join(root, path)))
        .digest("hex");
    } catch {
      return null;
    }
  });
}

describe("survivors re-key only when their environment's inputs change (001-370, review S1)", () => {
  // Row 011-88: a file-based project's config file is in its own environment only, so both rows re-key no survivor.
  it.each([
    ["e2e", "file-based, so its config file was in no other environment", false],
    ["web", "inline, so nothing of the others' environment changes", false],
  ])("excluding %s: %s", SLOW, async (name, _why, rekeys) => {
    let excluded: readonly string[] = [];
    const fx = await openFixture("five-projects", {}, (root) =>
      createVitestAdapter({ root, excludeProjects: () => excluded }),
    );
    const server = async () =>
      digest(
        fx.root,
        (await fx.adapter.environment()).find((e) => e.project === "server"),
      );
    const before = await server();
    excluded = [name];
    await fx.adapter.invalidate([{ path: "squeal.config.json", kind: "change" }]);
    expect((await server()) !== before).toBe(rekeys);
  });
});
