import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { decodeBundle } from "../../src/core/store/transfer-bundle.js";
import { partsExport } from "./export-harness.js";
import { ci, committed, recordVitest, scratch } from "./fixture.js";

/*
 * Issue #228: a test that asks whether a Windows path exists, as one that
 * sets `process.platform` to win32 does, observes `C:\Users\dev\repo` on
 * Linux. `squeal ci export` leaves that one file out, names it and the
 * path, and exports the rest; it refused the whole export before.
 */

const WINDOWS = "C:\\Users\\dev\\repo";

function fixture(dir: string): string {
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-export-absolute", private: true, type: "module" }),
    "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
    "test/plain.test.ts": `import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n`,
    "test/windows.test.ts": `import { existsSync } from "node:fs";\nimport { expect, it } from "vitest";\nit("looks for a Windows folder", () => expect(existsSync(${JSON.stringify(WINDOWS)})).toBe(false));\n`,
  });
}

describe("squeal ci export of a file that observed a Windows path (issue #228)", () => {
  it("leaves that file out, names it, and exports the rest", { timeout: 300_000 }, async () => {
    const origin = fixture(scratch("ci-export-absolute"));
    const out = join(dirname(origin), "parts");
    const recorded = await recordVitest(origin, out, []);
    expect(recorded.code, recorded.said).toBe(0);

    const job = await partsExport(origin, out);
    if (!("bundle" in job)) throw new Error(job.refused.text);
    expect(job.absolute).toEqual([
      { testFile: { project: "", path: "test/windows.test.ts" }, path: WINDOWS },
    ]);
    expect(job.counts).toMatchObject({ testFiles: 1, unkeyed: 0, absolute: 1 });
    expect(job.bundle.testFiles.map((f) => f.path)).toEqual(["test/plain.test.ts"]);

    const written = join(dirname(origin), "results.json.gz");
    const command = await ci(["export", "--parts", out, "--out", written], job.root);
    expect(command.code, command.said).toBe(0);
    expect(command.said).toContain(
      `left out test/windows.test.ts: it holds the absolute path ${WINDOWS}, which an export does not write`,
    );
    expect(command.said).toContain("Left out: 1 test file that holds an absolute path.");
    const decoded = decodeBundle(readFileSync(written));
    if (typeof decoded === "string") throw new Error(decoded);
    expect(decoded.testFiles.map((f) => f.path)).toEqual(["test/plain.test.ts"]);
  });
});
