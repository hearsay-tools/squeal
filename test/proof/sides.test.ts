import { describe, expect, it } from "vitest";
import {
  defaultCase,
  isTestSide,
  missingImport,
  sidesOf,
  testSideCopies,
} from "../../src/core/proof/sides.js";

/* Row 023-08, spec 023 D5's table and D5.2: sides, the default case, the copies and the refusal. */

const named = new Set(["test/a.test.ts"]);
const entry = (blob: string, mode = "100644") => ({ mode, blob });

describe("proof sides (row 023-08, D5)", () => {
  it("pairs each case's red and green versions as D5's table does", () => {
    expect(sidesOf("source", "B", "H")).toEqual({
      red: { tests: "H", code: "B" },
      green: { tests: "H", code: "H" },
    });
    expect(sidesOf("test", "B", "H").red).toEqual({ tests: "B", code: "H" });
  });

  it.each([
    ["test/a.test.ts", true],
    ["test/helpers/make.ts", true],
    ["src/__fixtures__/data.json", true],
    ["src/a.spec.tsx", true],
    ["pkg/a_test.go", true],
    ["py/test_a.py", true],
    ["src/a.ts", false],
    ["src/testing.ts", false],
    ["vitest.config.ts", false],
  ])("tells %s test-side: %s", (path, side) => {
    expect(isTestSide(path, named)).toBe(side);
  });

  it("defaults to source on a changed loaded source file, test on test-side changes only, none otherwise", () => {
    const loads = ["src/a.ts", "test/helpers/make.ts"];
    expect(
      defaultCase("test/a.test.ts", loads, new Set(["src/a.ts", "test/a.test.ts"]), named),
    ).toBe("source");
    expect(defaultCase("test/a.test.ts", loads, new Set(["test/helpers/make.ts"]), named)).toBe(
      "test",
    );
    expect(defaultCase("test/a.test.ts", loads, new Set(["test/a.test.ts"]), named)).toBe("test");
    expect(defaultCase("test/a.test.ts", loads, new Set(["src/other.ts"]), named)).toBeNull();
  });

  it("copies the test-side paths the test version holds otherwise, never a source file", () => {
    const tests = new Map([
      ["test/a.test.ts", entry("t2")],
      ["test/helpers/make.ts", entry("h2")],
      ["test/helpers/same.ts", entry("s")],
      ["test/fixtures/run.sh", entry("r", "100755")],
      ["src/a.ts", entry("a2")],
    ]);
    const code = new Map([
      ["test/helpers/make.ts", entry("h1")],
      ["test/helpers/same.ts", entry("s")],
      ["test/fixtures/run.sh", entry("r")],
      ["src/a.ts", entry("a1")],
    ]);
    expect(testSideCopies(tests, code, named)).toEqual([
      "test/a.test.ts",
      "test/fixtures/run.sh",
      "test/helpers/make.ts",
    ]);
  });

  it("refuses a loaded source file the code version lacks and the test version holds", () => {
    const tests = new Map([
      ["src/b.ts", entry("b")],
      ["test/h.ts", entry("h")],
    ]);
    const code = new Map<string, ReturnType<typeof entry>>();
    // A resolution candidate both versions lack, and a test-side file, are no refusal.
    expect(missingImport(["src/b.tsx", "test/h.ts"], tests, code, named)).toBeNull();
    expect(missingImport(["src/b.tsx", "src/b.ts"], tests, code, named)).toBe("src/b.ts");
  });
});
