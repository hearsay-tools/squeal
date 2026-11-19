import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { prove } from "./proof-kit.js";
import { clean } from "./status-at-kit.js";

/*
 * Row 023-22, spec 023 D5.5 as amended 2026-11-19 (the human on issue
 * #244, "A: evidence rule"): `squeal proof` on `$TMPDIR` git fixtures with
 * the real Vitest adapter. Commit A holds the bug (`value` 1); HEAD fixes
 * it (`value` 2) and adds the test.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Issue #244's shape: a wait helper in a test folder throws a plain `Error` the test body awaits. */
const WAIT_HELPER = [
  "export async function waitFor(predicate: () => boolean, ms = 20): Promise<void> {",
  "  const end = Date.now() + ms;",
  "  while (Date.now() < end) {",
  "    if (predicate()) return;",
  "    await new Promise((resolve) => setTimeout(resolve, 5));",
  "  }",
  '  throw new Error("predicate never became truthy: value is 2");',
  "}",
  "",
].join("\n");

function sourceFix(test: string, more: Readonly<Record<string, string>> = {}) {
  const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n", ...more });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: test });
  return { f, a };
}

const lines = (...text: string[]) => [...text, ""].join("\n");

describe("squeal proof red evidence (row 023-22, #244)", { timeout: 240_000 }, () => {
  it("proves a wait helper's plain Error thrown in the test body, labelled, exit 0", async () => {
    const { f, a } = sourceFix(
      lines(
        'import { it } from "vitest";',
        'import { value } from "../src/a";',
        'import { waitFor } from "./wait";',
        'it("shows the value", async () => {',
        "  await waitFor(() => value === 2);",
        "});",
      ),
      { "test/wait.ts": WAIT_HELPER },
    );
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(0);
    const [file] = result.files;
    expect(file).toMatchObject({
      verdict: "proven",
      reason:
        "red on a thrown error, not an assertion: Error: predicate never became truthy: value is 2",
      evidence: "thrown",
      green: { end: "pass" },
    });
    expect(file?.red.failures).toEqual([
      expect.objectContaining({ test: "shows the value", kind: "thrown" }),
    ]);
    clean(f);
    const text = await prove(f, { files: [TEST.path], base: a, json: false });
    expect(text.code, text.why).toBe(0);
    expect(text.out).toContain("test/a.test.ts: proven (red on a thrown error, not an assertion:");
    expect(text.out).toContain("shows the value [thrown]");
    clean(f);
  });

  it("counts a Playwright-style expect error without the AssertionError name as an assertion", async () => {
    const { f, a } = sourceFix(
      lines(
        'import { it } from "vitest";',
        'import { value } from "../src/a";',
        'it("has the text", () => {',
        "  if (value === 2) return;",
        '  const error = new Error("expect(locator).toHaveText(expected) failed");',
        '  Object.assign(error, { matcherResult: { pass: false, name: "toHaveText", expected: "2", actual: String(value) } });',
        "  throw error;",
        "});",
      ),
    );
    const result = await prove(f, { files: [TEST.path], base: a });
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      reason: null,
      evidence: "assertion",
    });
    expect(result.files[0]?.red.failures[0]).toMatchObject({ kind: "assertion" });
    clean(f);
  });

  it("keeps a beforeEach failure red for another reason, and --red-error accepts it", async () => {
    const { f, a } = sourceFix(
      lines(
        'import { beforeEach, expect, it } from "vitest";',
        'import { value } from "../src/a";',
        "beforeEach(() => {",
        '  if (value !== 2) throw new Error("page not ready");',
        "});",
        'it("value", () => expect(value).toBe(2));',
      ),
    );
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    const plain = await prove(f, { files: [TEST.path], base: a }, options);
    expect(plain.code, plain.why).toBe(3);
    expect(plain.files[0]).toMatchObject({
      verdict: "red for another reason",
      reason: "a hook or the file's teardown failed",
      evidence: null,
      green: null,
    });
    expect(plain.files[0]?.red.failures[0]).toMatchObject({ kind: "hook" });
    clean(f);
    // The red side is read from the store now: its stage survived the gate's write.
    const accepted = await prove(
      f,
      { files: [TEST.path], base: a, redErrors: ["page not ready"] },
      options,
    );
    expect(accepted.code, accepted.why).toBe(0);
    expect(accepted.report.redErrors).toEqual(["page not ready"]);
    expect(accepted.files[0]).toMatchObject({
      verdict: "proven",
      reason: "red on a thrown error, not an assertion: Error: page not ready",
      evidence: "thrown",
      red: { end: "fail", from: "store" },
      green: { end: "pass" },
    });
    expect(accepted.files[0]?.red.failures[0]).toMatchObject({ kind: "thrown" });
    clean(f);
  });
  it("reads the thrown label on a --with proof's red side, and keeps --red-error in its rerun", async () => {
    const thin = "src/thin.test.ts";
    const rows = "src/rows.testkit.ts";
    const kit = (...extra: string[]) =>
      lines(
        'import { it } from "vitest";',
        'import { value } from "./value";',
        WAIT_HELPER.replace("export async function", "async function"),
        "export function runKit() {",
        '  it("existing row", () => {});',
        ...extra,
        "}",
      );
    const f = fixture({
      ...ON,
      "vitest.config.mjs": 'export default { test: { include: ["src/*.test.ts"] } };\n',
      [thin]: 'import { runKit } from "./rows.testkit";\nrunKit();\n',
      "src/value.ts": "export const value = 1;\n",
      // Row 023-21 ("A: stop when unsure"): product code imports value, so it is settled as source.
      "src/main.ts": 'import { value } from "./value";\nexport const main = value;\n',
      [rows]: kit(),
    });
    const base = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({
      "src/value.ts": "export const value = 2;\n",
      [rows]: kit('  it("waits for the value", async () => waitFor(() => value === 2));'),
    });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
    // Row 023-21: without --with the unchanged thin test stops; the rerun keeps --red-error.
    const stopped = await prove(f, { files: [thin], base, redErrors: ["never"] }, options);
    expect(stopped.code, stopped.why).toBe(3);
    expect(stopped.report.withRerun).toBe(
      `squeal proof ${thin} --base ${base} --with ${rows} --red-error never`,
    );
    clean(f);
    const result = await prove(f, { files: [thin], base, with: [rows] }, options);
    expect(result.code, result.why).toBe(0);
    expect(result.files[0]).toMatchObject({
      verdict: "proven",
      reason:
        "red on a thrown error, not an assertion: Error: predicate never became truthy: value is 2",
      evidence: "thrown",
      red: { end: "fail" },
      green: { end: "pass" },
    });
    expect(result.files[0]?.red.failures).toEqual([
      expect.objectContaining({ test: "waits for the value", kind: "thrown" }),
    ]);
    clean(f);
  });
});
