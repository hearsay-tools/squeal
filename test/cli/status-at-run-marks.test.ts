import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-29 (lessons round 4, R8) on a `$TMPDIR` git fixture with the
 * real Vitest adapter: a file with no result at the commit that `--run`
 * did not select is marked so, and the run's count says it is of the
 * selected files only. Round 4's s7-04 read "9 of 9 … ran" beside such a
 * file and claimed a result at the parent for it.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");

/** Commit A: `a.test.ts` and `plain.test.ts`; HEAD changes `src/a.ts` and `a.test.ts` only. */
function changedA() {
  const f = fixture({
    "squeal.config.json": "{}\n",
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a, options: { cacheRoot: f.cacheRoot, install: linkInstall().install } };
}

const RUN = { allMissing: false, timeoutSeconds: 600 };
type Side = Record<string, unknown>;
const fileOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side; now: Side }[]).find((x) => x.path === path);

describe(
  "status --at --run marks the files the change did not select (row 023-29, R8)",
  SLOW,
  () => {
    it("names the unselected file with --all-missing, in text and JSON, and counts it", async () => {
      const { f, a, options } = changedA();
      const at = a.slice(0, 9);
      // A folder selects both files; it names neither of them itself.
      const text = await run(f, { commit: a, paths: ["test"], run: RUN }, options);
      expect(text.out).toContain(
        `${PLAIN.path}: no result at ${at}, not selected by the change; \`--all-missing\` runs it; now `,
      );
      expect(text.out).toContain(
        `--run: 1 of 1 test files with no result at ${at} that the change selects ran in its checkout`,
      );
      expect(text.out).toContain(
        `1 more with no result at ${at} not selected by the change did not run; \`--all-missing\` runs it`,
      );
      expect(text.out).not.toContain(`${TEST.path}: no result at ${at}, not selected`);

      const json = await run(f, { commit: a, json: true, paths: ["test"], run: RUN }, options);
      expect(fileOf(json.out, PLAIN.path)?.at).toMatchObject({
        state: "no result",
        notSelected: true,
      });
      expect(JSON.parse(json.out).run).toMatchObject({ selected: 0, notSelected: 1 });
      clean(f);
    });
  },
);

describe(
  "status --at <file> --run runs the file it names (row 023-29, row 023-32's finding)",
  SLOW,
  () => {
    it("runs a named test file the change does not select, on both sides", async () => {
      const { f, a, options } = changedA();
      const at = a.slice(0, 9);
      // On 0.1.577: "no file with no result at <commit> to run" beside the file's own `no result`.
      const text = await run(f, { commit: a, paths: [PLAIN.path], run: RUN }, options);
      expect(text.out).not.toContain("no file with no result");
      expect(text.out).not.toContain("not selected by the change");
      expect(text.out).toContain(
        `--run: 1 of 1 test files with no result at ${at} ran in its checkout, 1 stored at its keys`,
      );
      expect(text.out).toContain(
        "--run, now: 1 of 1 test files the change selects with no result in the working tree ran there",
      );
      expect(text.out).toContain("0 pass -> fail, 0 fail -> pass, 1 unchanged, 0 unknown");
      expect(text.code).toBe(0);

      // Both results are stored: the next call reads them with no run.
      const json = await run(f, { commit: a, json: true, paths: [PLAIN.path] }, options);
      expect(fileOf(json.out, PLAIN.path)).toMatchObject({
        at: { state: "pass" },
        // Its key is the same at both commits: the newest result at it may be either side's.
        now: { state: "pass" },
      });
      clean(f);
    });
  },
);
