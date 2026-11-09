import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ci, cloneOf, committed, recordVitest, scratch, VITEST } from "./fixture.js";

/*
 * Review of 0.1.421 B2 (spec 018 D9 as amended 2026-11-09): the export
 * compares the shards' snapshot options with its own field by field, only
 * the update mode aside. The fixture's snapshot was written with
 * `printBasicPrototype: true` (`Object {`); a shard with that format passes.
 * An export job whose config resolves the format otherwise, where the same
 * test fails, refuses the parts; one with the shards' format exports them.
 */

const FLAG = "SQUEAL_REVIEW_SNAPSHOT_FORMAT";

const FILES = {
  "package.json": JSON.stringify({ name: "ci-snapshot-fixture", private: true, type: "module" }),
  ".gitignore": "node_modules/\n",
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/*.test.ts"], snapshotFormat: { printBasicPrototype: process.env.${FLAG} === "true" } } });\n`,
  "test/a.test.ts": `import { expect, it } from "vitest";\nit("snapshot", () => expect({ x: 1 }).toMatchSnapshot());\n`,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("ci export compares the snapshot options but the update mode (review of 0.1.421 B2)", () => {
  it("refuses shards whose snapshot format is not the job's", { timeout: 300_000 }, async () => {
    const origin = committed(scratch("ci-snapshot"), FILES, (root) => {
      const env = { ...process.env, [FLAG]: "true" };
      execFileSync(process.execPath, [VITEST, "run", "-u"], { cwd: root, env, stdio: "ignore" });
    });
    expect(existsSync(join(origin, "test/__snapshots__/a.test.ts.snap"))).toBe(true);
    const out = join(dirname(origin), "parts");
    const recorded = await recordVitest(origin, out, [], { [FLAG]: "true" });
    expect(recorded.code, recorded.said).toBe(0);
    expect(readdirSync(out)).toHaveLength(1);

    const root = cloneOf(origin, "export");
    const target = join(root, "results.json.gz");
    vi.stubEnv(FLAG, "false");
    const refused = await ci(["export", "--parts", out, "--out", target], root);
    expect(refused.code, refused.said).toBe(1);
    expect(refused.said).toContain("config fields snapshotOptions.snapshotFormat differ");
    expect(existsSync(target)).toBe(false);

    vi.stubEnv(FLAG, "true");
    const exported = await ci(["export", "--parts", out, "--out", target], root);
    expect(exported.code, exported.said).toBe(0);
    expect(exported.said).toContain("Exported 1 test file, 2 results");
  });
});
