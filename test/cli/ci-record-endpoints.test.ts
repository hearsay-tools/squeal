import { execFileSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Part, readPart } from "../../src/core/ci/parts.js";
import { committed, recordVitest, scratch } from "../ci/fixture.js";
import { gitHashObject } from "../hash/git-repo.js";

/*
 * Spec 018 D30 to D32 (row 018-57): a Vitest command under `squeal ci
 * record` writes format 6 parts with the endpoint hashes, `stable` holding
 * only paths that differ from the commit, `unstable` the paths the command
 * changed and kept, and `touched` the paths its hooked processes wrote; a
 * withheld child makes every path touched. The cost line names the hashing.
 */

const SLOW = { timeout: 180_000 } as const;

const READ = (name: string) =>
  `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("reads ${name}", () => {\n  expect(readFileSync("data/${name}.txt", "utf8")).toBe("${name}\\n");\n});\n`;

const FILES = {
  "package.json": JSON.stringify({ name: "ci-record-endpoints", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "data/a.txt": "a\n",
  "data/dirty.txt": "committed\n",
  "data/grow.txt": "grow\n",
  "data/written.txt": "written\n",
  "test/a.test.ts": READ("a"),
  // Node writes a file and restores it: touched, though its ends are equal.
  "test/write.test.ts": `import { writeFileSync } from "node:fs";\nimport { it } from "vitest";\nit("writes", () => {\n  writeFileSync("data/written.txt", "other\\n");\n  writeFileSync("data/written.txt", "written\\n");\n});\n`,
  // A shell changes a file and keeps the change: no hooked process saw it.
  "test/shell.test.ts": `import { execFileSync } from "node:child_process";\nimport { it } from "vitest";\nit("grows", () => {\n  execFileSync("sh", ["-c", "echo more >> data/grow.txt"]);\n});\n`,
};

function partsIn(dir: string): Part[] {
  return readdirSync(dir).map((name) => {
    const part = readPart(join(dir, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
}

describe("ci record's endpoint hashes and touched paths (Vitest)", () => {
  it(
    "holds the paths that differ from the commit, those the command changed, and those its processes wrote",
    SLOW,
    async () => {
      const dir = scratch("ci-endpoints");
      const root = committed(dir, FILES);
      writeFileSync(join(root, "data/dirty.txt"), "changed before\n");
      const out = join(dir, "parts");
      const { code, said } = await recordVitest(root, out);
      expect(code, said).toBe(0);
      const parts = partsIn(out);
      expect(parts).toHaveLength(1);
      const part = parts[0] as Part;
      expect(part.format).toBe("squeal-ci-part/6");

      expect(part.stable?.["data/dirty.txt"]).toBe(gitHashObject(root, "data/dirty.txt"));
      // `.git` is on the disk, never in the commit's tree.
      expect(part.stable?.["./"] ?? part.unstable?.includes("./")).toBeTruthy();
      const differs = Object.keys(part.stable ?? {}).filter((path) => path !== "./");
      expect(differs).toEqual(["data/dirty.txt"]);
      expect(part.unstable).toEqual(expect.arrayContaining(["data/grow.txt"]));
      expect(part.unstable).not.toContain("data/written.txt");
      expect(part.unstable).not.toContain("data/a.txt");
      expect(part.unstable?.filter((path) => path.startsWith("data/"))).toEqual(["data/grow.txt"]);
      expect(part.stable?.["data/"]).toBeUndefined();

      expect(part.touched).toEqual(expect.arrayContaining(["data/written.txt"]));
      expect(part.touched).not.toContain("data/a.txt");
      expect(part.touched).not.toContain("data/grow.txt");

      expect(part.header.cost?.endpointsMs).toBeGreaterThanOrEqual(0);
      expect(said).toMatch(/; \d+\.\d+ s hashing the checkout before and after it/);
    },
  );

  it(
    "makes every path touched when a child starts with another recording's settings",
    SLOW,
    async () => {
      const dir = scratch("ci-endpoints-withheld");
      const root = committed(dir, {
        ...FILES,
        "test/write.test.ts": `import { execFileSync } from "node:child_process";\nimport { it } from "vitest";\nit("records itself", () => {\n  execFileSync(process.execPath, ["-e", "0"], { env: { ...process.env, SQUEAL_CI_RECORD: "{}" } });\n});\n`,
      });
      const out = join(dir, "parts");
      const { code, said } = await recordVitest(root, out);
      expect(code, said).toBe(0);
      const [part] = partsIn(out);
      expect(part?.touched).toBe("all");
      expect(part?.stable).toBeDefined();
    },
  );

  it("names why it took no endpoint hash when HEAD moves during the command", SLOW, async () => {
    const dir = scratch("ci-endpoints-moved");
    const root = committed(dir, {
      ...FILES,
      "test/shell.test.ts": `import { execFileSync } from "node:child_process";\nimport { it } from "vitest";\nit("commits", () => {\n  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "m"]);\n});\n`,
    });
    const out = join(dir, "parts");
    const { code, said } = await recordVitest(root, out);
    expect(code, said).toBe(0);
    expect(said).toContain("no endpoint hashes: HEAD moved during the command");
    const [part] = partsIn(out);
    expect(part?.stable).toBeUndefined();
    expect(part?.unstable).toBeUndefined();
    expect(Array.isArray(part?.touched)).toBe(true);
    expect(part?.header.cost?.endpointsMs).toBeUndefined();
    expect(execFileSync("git", ["log", "--oneline"], { cwd: root, encoding: "utf8" })).toMatch(
      /m\n/,
    );
  });
});
