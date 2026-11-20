import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean, testOf } from "./status-at-kit.js";

/*
 * Row 023-08, done-when; spec 023 D5.1, D5.2, D5.5, D5.6: `squeal proof`
 * on `$TMPDIR` git fixtures with the real Vitest adapter. Coverage is on,
 * as by default, so the gate keeps what a side runs in the shared stores
 * at the side's keys.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit A holds the bug (`value` 1); HEAD fixes it and adds the test that expects 2. */
function sourceFix() {
  const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a };
}

describe("squeal proof (row 023-08, D5)", { timeout: 240_000 }, () => {
  it("proves a source fix with the red side's assertion, and a second call runs nothing", async () => {
    const { f, a } = sourceFix();
    const install = linkInstall();
    const options = { cacheRoot: f.cacheRoot, install: install.install };

    const first = await prove(f, { files: [TEST.path], base: a }, options);
    expect(first.code, first.why).toBe(0);
    expect(first.report).toMatchObject({ version: "squeal-proof/1", case: "source", base: a });
    expect(first.report.red).toEqual({ tests: first.report.head, code: a, with: [], source: [] });
    const [file] = first.files;
    expect(file).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "run", stored: true },
    });
    expect(file?.red.failures).toEqual([
      expect.objectContaining({
        test: "value",
        kind: "assertion",
        text: expect.stringContaining("expected 1 to be 2"),
      }),
    ]);
    expect(file?.green).toMatchObject({ end: "pass", from: "run" });
    expect(first.report.runs).toBe(2);
    clean(f);

    const second = await prove(f, { files: [TEST.path], base: a }, options);
    expect(second.code, second.why).toBe(0);
    expect(second.files[0]).toMatchObject({
      verdict: "proven",
      red: { end: "fail", from: "store" },
      green: { end: "pass", from: "store" },
    });
    expect(second.files[0]?.red.failures[0]?.text).toContain("expected 1 to be 2");
    expect(second.report.runs).toBe(0);
    clean(f);

    const text = await prove(f, { files: [TEST.path], base: a, json: false }, options);
    expect(text.out).toContain(`squeal proof (case source): base ${a.slice(0, 9)}`);
    // Row 023-30 (R5): the changed test's verdict line says it is not the file's result at a.
    expect(text.out).toContain(
      `test/a.test.ts: proven: the new test fails on the old code. This is not the file's result at ${a.slice(0, 9)}; that is \`squeal status --at ${a.slice(0, 9)} test/a.test.ts --run\`\n`,
    );
    expect(text.out).toContain("AssertionError: expected 1 to be 2");
  });

  it("proves a test-only fix: the old test over the current code fails", async () => {
    const f = fixture({
      ...ON,
      "src/a.ts": "export const value = 2;\n",
      [TEST.path]: testOf("a", 3),
    });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ [TEST.path]: testOf("a", 2) });
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(0);
    expect(result.report.case).toBe("test");
    expect(result.report.red).toEqual({ tests: a, code: result.report.head, with: [], source: [] });
    expect(result.files[0]).toMatchObject({ verdict: "proven", red: { end: "fail" } });
    expect(result.files[0]?.red.failures[0]?.text).toContain("expected 2 to be 3");
    clean(f);
  });

  it("reads not red when the test passes on the old code (exit 1)", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 2;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2; // tidied\n", [TEST.path]: testOf("a", 2) });
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(1);
    expect(result.files[0]).toMatchObject({
      verdict: "not red",
      red: { end: "pass" },
      green: null,
      greenNotRun: "red passed: nothing to prove",
    });
    clean(f);
    // Row 023-20 (lessons P7): the text says why green did not run, never "not read".
    const text = await prove(f, { files: [TEST.path], base: a, json: false });
    // Row 023-24 (Q6): what the proof does not show; Q5: the changed test's red side is not its result at a.
    expect(text.out).toContain(
      "  green: not run. Red passed, so this proof says nothing about HEAD; `squeal status test/a.test.ts` gives its result now.\n",
    );
    expect(text.out).toContain(
      `not the file's own result at ${a.slice(0, 9)}; that is \`squeal status --at ${a.slice(0, 9)} test/a.test.ts --run\`.\n`,
    );
    expect(text.out).not.toContain("not read");
    clean(f);
  });

  it("reads red for another reason when the red side fails on a missing export (exit 3)", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    const test = [
      'import { expect, it } from "vitest";',
      'import { fixed } from "../src/a";',
      'it("fixed", () => expect(fixed()).toBe(2));',
      "",
    ].join("\n");
    f.commit({
      "src/a.ts": "export const value = 1;\nexport const fixed = () => 2;\n",
      [TEST.path]: test,
    });
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({ verdict: "red for another reason", green: null });
    expect(result.files[0]?.red.failures[0]).toMatchObject({ test: "fixed", kind: "error" });
    expect(result.files[0]?.red.failures[0]?.text).toContain("TypeError");
    clean(f);
  });

  it("reads not comparable, with no run, when the test imports a source file the base lacks", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n" });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/a.ts": "export const value = 2;\n",
      "src/b.ts": "export const value = 2;\n",
      [TEST.path]: `${testOf("a", 2)}import "../src/b";\n`,
    });
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(3);
    expect(result.files[0]).toMatchObject({
      verdict: "not comparable",
      reason: `imports src/b.ts, absent at ${a.slice(0, 9)}`,
    });
    expect(result.report.runs).toBe(0);
    clean(f);
  });
});
