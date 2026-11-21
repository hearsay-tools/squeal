import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ciCommand } from "../../src/cli/ci.js";
import type { EndpointsOptions } from "../../src/core/ci/endpoints.js";
import { type Part, readPart } from "../../src/core/ci/parts.js";
import { hashFile } from "../../src/core/hash/blob.js";
import { committed, scratch, VITEST } from "../ci/fixture.js";

/*
 * Row 018-61 (review 0.1.582 S1, spec 018 D30, D20.2): a stalled read in
 * `ci record`'s endpoint hashing, before or after the command, gives up at
 * the limit: the command starts in time, its exit code decides, and the
 * parts are written without endpoint hashes (D9 alone at export), with one
 * note.
 */

const SLOW = { timeout: 180_000 } as const;
const FLOOR_MS = 500;
const never = new Promise<never>(() => {});

const FILES = {
  "package.json": JSON.stringify({ name: "ci-record-limit", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "data/a.txt": "a\n",
  "test/a.test.ts": `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("reads a", () => {\n  expect(readFileSync("data/a.txt", "utf8")).toBe("a\\n");\n});\n`,
};

/** `ci record` of a shell that marks when it started, then runs Vitest; `stall` says which reads never end. */
async function record(root: string, out: string, stall: (path: string) => boolean) {
  const endpoints: EndpointsOptions = {
    limit: { floorMs: FLOOR_MS, multiple: 4 },
    hashFile: (path, format) => (stall(path) ? never : hashFile(path, format)),
  };
  const mark = `node -e 'require("fs").writeFileSync("started", String(Date.now()))'`;
  const command = ["sh", "-c", `${mark} && exec "${process.execPath}" "${VITEST}" run`];
  let said = "";
  const add = (text: string) => {
    said += text;
  };
  const begin = Date.now();
  const code = await ciCommand(
    ["record", "--out", out, "--", ...command],
    { stdout: add, stderr: add, cwd: root, env: { ...process.env, CI: "true" } },
    { endpoints },
  );
  const started = Number(readFileSync(join(root, "started"), "utf8")) - begin;
  const parts = readdirSync(out).map((name) => {
    const part = readPart(join(out, name));
    if (typeof part === "string") throw new Error(part);
    return part;
  });
  return { code, said, started, parts };
}

describe("ci record past the endpoint hashing's limit", () => {
  it(
    "starts the command when a read before it stalls, and writes parts without endpoint hashes",
    SLOW,
    async () => {
      const dir = scratch("ci-record-limit-before");
      const root = committed(dir, FILES);
      const stalled = join(root, "data/a.txt");
      const { code, said, started, parts } = await record(
        root,
        join(dir, "parts"),
        (path) => path === stalled,
      );
      expect(code, said).toBe(0);
      // Without the limit the command never starts; with it, soon after the floor.
      expect(started).toBeGreaterThanOrEqual(FLOOR_MS - 50);
      expect(started).toBeLessThan(FLOOR_MS + 10_000);
      expect(said.match(/no endpoint hashes: .*/g)).toEqual([
        expect.stringMatching(
          /^no endpoint hashes: hashing the checkout passed its limit of 0\.5 s \(\d+ of \d+ paths\)$/,
        ),
      ]);
      expect(parts).toHaveLength(1);
      const part = parts[0] as Part;
      expect(part.format).toBe("squeal-ci-part/6");
      expect(part.stable).toBeUndefined();
      expect(part.unstable).toBeUndefined();
      expect(Array.isArray(part.touched)).toBe(true);
      expect(part.header.cost?.endpointsMs).toBeUndefined();
      expect(part.testFiles.map((file) => file.path)).toEqual(["test/a.test.ts"]);
    },
  );

  it(
    "writes parts without endpoint hashes when a read after the command stalls",
    SLOW,
    async () => {
      const dir = scratch("ci-record-limit-after");
      const root = committed(dir, FILES);
      const stalled = join(root, "data/a.txt");
      // The marker is untracked, so never hashed; it exists only once the command started.
      const { code, said, parts } = await record(
        root,
        join(dir, "parts"),
        (path) => path === stalled && existsSync(join(root, "started")),
      );
      expect(code, said).toBe(0);
      expect(said.match(/no endpoint hashes: .*/g)).toEqual([
        expect.stringMatching(
          /^no endpoint hashes: hashing the checkout passed its limit of 0\.5 s/,
        ),
      ]);
      expect(parts).toHaveLength(1);
      const part = parts[0] as Part;
      expect(part.stable).toBeUndefined();
      expect(part.unstable).toBeUndefined();
      expect(part.testFiles.map((file) => file.path)).toEqual(["test/a.test.ts"]);
    },
  );
});
