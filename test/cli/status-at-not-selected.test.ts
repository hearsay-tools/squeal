import { describe, expect, it } from "vitest";
import { fixture, git, write } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { run } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/*
 * Row 023-35 (lessons round 5, T2) on a `$TMPDIR` git fixture with the
 * real node:test adapter: a file the change did not select, whose static
 * closure the runner tells complete, reads as one the commit cannot
 * change, counted apart from "unknown". One with an incomplete closure
 * (a computed `import()`) is excepted and stays unknown. On 0.1.585 both
 * read "no result at <commit>, not selected by the change", counted in
 * "unknown", and 10 of 10 round-5 sessions read that as "not compared".
 * Row 023-40c: the real commit daemon selects and tells its node:test
 * project's incomplete closures through its reads.
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

const RUN = { allMissing: false };
/** The call waits until the commit daemon ran what it selected. */
const WAIT = 120_000;

/** A real commit daemon for `f`. */
const daemonsOf = (f: { root: string; cacheRoot: string }) => ({
  cacheRoot: f.cacheRoot as never,
  daemons: realCommitDaemon(f.root).daemons,
});

describe("status --at --run: what not selected means (row 023-35, T2)", SLOW, () => {
  it("says the commit cannot change a file with a complete closure, and excepts the incomplete one", async () => {
    const { f, a } = changedA();
    const at = a.slice(0, 9);

    const options = daemonsOf(f);
    const text = await run(f, { commit: a, run: RUN, waitMs: WAIT }, options);
    expect(text.out).toContain(
      `1 test file not selected: none of its inputs differs between ${at} and the working tree, so this commit cannot change its result (the one with an incomplete static closure excepted; \`--json\` lists them in notSelected.excepted): ${PLAIN}\n`,
    );
    expect(text.out).toContain(
      `${DYN}: no result at ${at}, not selected by the change, but the static closure is incomplete; \`--all-missing\` runs it; now `,
    );
    expect(text.out).not.toContain(`${PLAIN}: no result at ${at}`);
    // Row 023-40: no daemon in the working tree, so `a.test.mjs` has no result now;
    // `dyn.test.mjs` is excepted.
    expect(text.out).toContain("0 unchanged, 2 unknown, 1 not selected\n");

    const json = JSON.parse(
      (await run(f, { commit: a, json: true, run: RUN, waitMs: WAIT }, options)).out,
    );
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
  });
});

/*
 * Review wave-20 B5: the selection read `<commit>..HEAD`, so a source a
 * not-selected file imports may differ in the working tree. On 126acb669
 * the witness read "1 test file not selected: none of its inputs differs
 * … so this commit cannot change its result" with `src/plain.mjs` dirty.
 * Row 023-40c (D7.3 as amended): the change the commit daemon selects with
 * holds the working tree's uncommitted paths too, so such a file runs at
 * the commit and is compared, never said unchangeable.
 */
describe(
  "status --at --run: uncommitted changes select a file (review wave-20 B5, row 023-40c)",
  SLOW,
  () => {
    const sideOf = (out: string, path: string) =>
      (JSON.parse(out).files as { path: string; at: Record<string, unknown> }[]).find(
        (x) => x.path === path,
      )?.at;

    it("an unstaged change to a source it imports: run at the commit, not said unchangeable", async () => {
      const { f, a } = changedA();
      write(f.root, { "src/plain.mjs": "export const value = 2;\n" });
      const options = daemonsOf(f);
      const text = await run(f, { commit: a, run: RUN, waitMs: WAIT }, options);
      expect(text.out).not.toContain("so this commit cannot change");
      const json = JSON.parse(
        (await run(f, { commit: a, json: true, run: RUN, waitMs: WAIT }, options)).out,
      );
      expect(sideOf(JSON.stringify(json), PLAIN)).toMatchObject({ state: "pass" });
      expect(json.notSelected.files).toBe(0);
    });

    it("a staged change to a source it imports: run at the commit", async () => {
      const { f, a } = changedA();
      write(f.root, { "src/plain.mjs": "export const value = 2;\n" });
      git(f.root, "add", "src/plain.mjs");
      const json = await run(f, { commit: a, json: true, run: RUN, waitMs: WAIT }, daemonsOf(f));
      expect(sideOf(json.out, PLAIN)).toMatchObject({ state: "pass" });
    });

    it("an uncommitted change it does not read: still not selected, and the commit cannot change it", async () => {
      const { f, a } = changedA();
      f.commit({ "README.md": "one\n" });
      write(f.root, { "README.md": "two\n", "notes.txt": "untracked\n" });
      const json = await run(f, { commit: a, json: true, run: RUN, waitMs: WAIT }, daemonsOf(f));
      expect(sideOf(json.out, PLAIN)).toMatchObject({ notSelected: true, closure: "complete" });
      expect(JSON.parse(json.out).notSelected.files).toBe(1);
    });
  },
);
