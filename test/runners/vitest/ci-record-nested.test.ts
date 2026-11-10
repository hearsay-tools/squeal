import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { readPart } from "../../../src/core/ci/parts.js";
import { ci, cloneOf, committed, recordVitest, scratch, VITEST } from "../../ci/fixture.js";

/*
 * Spec 018 D8, row 018-27 (cezar merge-group run 42821041101): a Vitest run
 * that a test starts itself is not the project's run. Its evidence still
 * counts, but it writes no part, so `squeal ci export` sees only the
 * project's runs. The test file below starts three: one with the env it
 * inherits, one with an env of its own (the hook puts its settings back),
 * and one whose test ends it early, as a cezar test does on purpose. The
 * second rewrites, unchanged, a file the outer test read: that write still
 * cancels the file's evidence.
 */

/** A test that starts Vitest in `inner/` three times, beside a plain test. */
function fixture(dir: string): string {
  const nested = `import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
const VITEST = ${JSON.stringify(VITEST)};
const inner = fileURLToPath(new URL("../inner/", import.meta.url));
const args = (filter) => [VITEST, "run", filter];
readFileSync(new URL("../inner/data.txt", import.meta.url));
it("starts Vitest with the env it inherits", async () => {
  const { stdout } = await promisify(execFile)(process.execPath, args("pass"), { cwd: inner });
  expect(stdout).toContain("1 passed");
});
it("starts Vitest with an env of its own", () => {
  const env = { PATH: process.env.PATH ?? "" };
  const { status, stdout } = spawnSync(process.execPath, args("write"), { cwd: inner, env, encoding: "utf8" });
  expect(status, stdout).toBe(0);
});
it("starts Vitest whose test ends the run early", () => {
  const { status } = spawnSync(process.execPath, args("exit"), { cwd: inner, encoding: "utf8" });
  expect(status).not.toBe(0);
});
`;
  return committed(dir, {
    "package.json": JSON.stringify({ name: "ci-nested-fixture", private: true, type: "module" }),
    "vitest.config.ts": `export default { test: { include: ["test/**/*.test.ts"] } };\n`,
    "test/plain.test.ts": `import { expect, it } from "vitest";\nit("adds", () => expect(1 + 1).toBe(2));\n`,
    "test/nested.test.ts": nested,
    "inner/vitest.config.ts": `export default { test: { include: ["*.test.ts"] } };\n`,
    "inner/pass.test.ts": `import { it } from "vitest";\nit("passes", () => {});\n`,
    "inner/write.test.ts": `import { writeFileSync } from "node:fs";\nimport { it } from "vitest";\nit("writes", () => writeFileSync("data.txt", "data\\n"));\n`,
    "inner/data.txt": "data\n",
    "inner/exit.test.ts": `import { it } from "vitest";\nit("ends the run", () => {\n  process.exit(3);\n});\n`,
  });
}

describe("squeal ci record beside Vitest runs that tests start (row 018-27)", () => {
  it("writes one part, the project's, and its export succeeds", { timeout: 300_000 }, async () => {
    const origin = fixture(scratch("ci-nested"));
    const out = join(dirname(origin), "parts");
    const recorded = await recordVitest(origin, out);
    expect(recorded.code, recorded.said).toBe(0);

    const names = readdirSync(out);
    expect(names, recorded.said).toHaveLength(1);
    const part = readPart(join(out, names[0] as string));
    if (typeof part === "string") throw new Error(part);
    expect(part.header.end).toBe("completed");
    expect(part.header.shard).toEqual({ index: 1, count: 1 });
    expect(part.testFiles.map((f) => [f.path, f.outcome])).toEqual([
      ["test/nested.test.ts", "pass"],
      ["test/plain.test.ts", "pass"],
    ]);

    expect(part.evidence["test/plain.test.ts"]).toEqual(expect.any(String));
    expect(part.evidence).not.toHaveProperty(["inner/data.txt"]);

    // The nested runs wrote in `inner/`, which the outer test read: only the plain test is exported.
    const root = cloneOf(origin, "export");
    const file = join(dirname(origin), "results.json.gz");
    const exported = await ci(["export", "--parts", out, "--out", file], root);
    expect(exported.code, exported.said).toBe(0);
    expect(exported.said).toContain("left out test/nested.test.ts");
    expect(exported.said).toContain(`Exported 1 test file, 2 results, to ${file}.`);
  });
});
