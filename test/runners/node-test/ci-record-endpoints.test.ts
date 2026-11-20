import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { gitHashObject } from "../../hash/git-repo.js";
import {
  FILES,
  nodeTestCommand,
  type Packages,
  project,
  record,
  reporterPair,
  TEST_FILES,
} from "./ci-record-kit.js";

/*
 * Spec 018 D30 to D32 (row 018-57): a node:test command under `squeal ci
 * record`, alone and beside Vitest's recording, writes format 6 parts with
 * the endpoint hashes and the touched paths, as a Vitest command does.
 */

const SLOW = { timeout: 120_000 } as const;

const WRITES = {
  ...FILES,
  "lib/data.txt": "data\n",
  "test/write.test.mjs": [
    'import { writeFileSync } from "node:fs";',
    'import { test } from "node:test";',
    'test("writes", () => { writeFileSync("lib/data.txt", "other\\n"); writeFileSync("lib/data.txt", "data\\n"); });',
    "",
  ].join("\n"),
};

describe("ci record of a node:test command: endpoint hashes and touched paths", () => {
  const PACKAGES: readonly Packages[] = ["tsx", "all"];
  it.each(PACKAGES)("holds them in its part (%s)", SLOW, async (packages) => {
    const root = project(WRITES, packages);
    writeFileSync(join(root, "lib/a.mjs"), "export const a = 1; // changed before\n");
    const files = [...TEST_FILES, "test/write.test.mjs"];
    const recorded = await record(
      root,
      nodeTestCommand(process.execPath, [...reporterPair(), ...files]),
    );
    expect(recorded.code, recorded.stderr).toBe(0);
    const part = recorded.parts.find((p) => p.header.runner === "node-test");
    if (part === undefined) throw new Error(recorded.stderr);
    expect(part.format).toBe("squeal-ci-part/6");
    const differs = Object.keys(part.stable ?? {}).filter((path) => path !== "./");
    expect(differs).toEqual(["lib/a.mjs"]);
    expect(part.stable?.["lib/a.mjs"]).toBe(gitHashObject(root, "lib/a.mjs"));
    expect(part.unstable?.filter((path) => path !== "./")).toEqual([]);
    expect(part.touched).toEqual(expect.arrayContaining(["lib/data.txt"]));
    expect(part.touched).not.toContain("lib/b.cjs");
    expect(part.header.cost?.endpointsMs).toBeGreaterThanOrEqual(0);
    expect(recorded.stderr).toMatch(/s hashing the checkout before and after it/);
  });
});
