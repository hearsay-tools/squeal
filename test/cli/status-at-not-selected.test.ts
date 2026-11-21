import { describe, expect, it } from "vitest";
import { fixture, git } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run } from "./status-at-kit.js";

/*
 * Row 023-35 (lessons round 5, T2) on a `$TMPDIR` git fixture with the
 * real node:test adapter: a file the change did not select, whose static
 * closure the runner tells complete, reads as one the commit cannot
 * change, counted apart from "unknown". One with an incomplete closure
 * (a computed `import()`) is excepted and stays unknown. On 0.1.585 both
 * read "no result at <commit>, not selected by the change", counted in
 * "unknown", and 10 of 10 round-5 sessions read that as "not compared".
 */

const nodeTest = (body: string) =>
  `import test from "node:test";\nimport assert from "node:assert/strict";\n${body}\n`;

const A = "test/a.test.mjs";
const PLAIN = "test/plain.test.mjs";
const DYN = "test/dyn.test.mjs";

function changedA() {
  const f = fixture({
    "squeal.config.json": `${JSON.stringify({
      coverage: { enabled: false },
      nodeTest: [{ name: "unit", include: ["test/*.test.mjs"] }],
    })}\n`,
    "src/a.mjs": "export const value = 1;\n",
    "src/plain.mjs": "export const value = 1;\n",
    [A]: nodeTest(
      'import { value } from "../src/a.mjs";\ntest("a", () => assert.equal(typeof value, "number"));',
    ),
    [PLAIN]: nodeTest(
      'import { value } from "../src/plain.mjs";\ntest("plain", () => assert.equal(value, 1));',
    ),
    [DYN]: nodeTest(
      // A specifier with no static part: the graph cannot tell what it loads.
      'const spec = ["..", "src", "plain.mjs"].join("/");\nconst { value } = await import(spec);\ntest("dyn", () => assert.equal(value, 1));',
    ),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.mjs": "export const value = 2;\n" });
  return { f, a };
}

const RUN = { allMissing: false, timeoutSeconds: 600 };

describe("status --at --run: what not selected means (row 023-35, T2)", SLOW, () => {
  it("says the commit cannot change a file with a complete closure, and excepts the incomplete one", async () => {
    const { f, a } = changedA();
    const at = a.slice(0, 9);

    const text = await run(f, { commit: a, run: RUN });
    expect(text.out).toContain(
      `1 test file not selected: none of its inputs differs between ${at} and the working tree, so this commit cannot change its result (the one with an incomplete static closure excepted; \`--json\` lists them in notSelected.excepted): ${PLAIN}\n`,
    );
    expect(text.out).toContain(
      `${DYN}: no result at ${at}, not selected by the change, but the static closure is incomplete; \`--all-missing\` runs it; now `,
    );
    expect(text.out).not.toContain(`${PLAIN}: no result at ${at}`);
    // `a.test.mjs` has no result now, and `dyn.test.mjs` is excepted.
    expect(text.out).toContain("0 unchanged, 2 unknown, 1 not selected\n");

    const json = JSON.parse((await run(f, { commit: a, json: true, run: RUN })).out);
    // The old fields keep their meaning: both files are in `counts.unknown`.
    expect(json.counts.unknown).toBeGreaterThanOrEqual(2);
    expect(json.notSelected).toEqual({
      files: 1,
      excepted: [{ project: "unit", path: DYN, closure: "incomplete" }],
    });
    const side = (path: string) =>
      (json.files as { path: string; at: unknown }[]).find((x) => x.path === path)?.at;
    expect(side(PLAIN)).toMatchObject({ notSelected: true, closure: "complete" });
    expect(side(DYN)).toMatchObject({ notSelected: true, closure: "incomplete" });
    clean(f);
  });
});
