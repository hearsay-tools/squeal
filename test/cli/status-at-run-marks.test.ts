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

describe(
  "status --at --run marks the files the change did not select (row 023-29, R8)",
  SLOW,
  () => {
    it("names the unselected file with --all-missing, in text and JSON, and counts it", async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        "src/a.ts": "export const value = 1;\n",
        [TEST.path]: testOf("a", 1),
        "src/plain.ts": "export const value = 1;\n",
        [PLAIN.path]: testOf("plain", 1),
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
      const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
      const at = a.slice(0, 9);
      const runArgs = { allMissing: false, timeoutSeconds: 600 };

      const text = await run(
        f,
        { commit: a, paths: [PLAIN.path, TEST.path], run: runArgs },
        options,
      );
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

      const json = await run(
        f,
        { commit: a, json: true, paths: [PLAIN.path], run: runArgs },
        options,
      );
      const files = JSON.parse(json.out).files as { path: string; at: Record<string, unknown> }[];
      expect(files.find((file) => file.path === PLAIN.path)?.at).toMatchObject({
        state: "no result",
        notSelected: true,
      });
      expect(JSON.parse(json.out).run).toMatchObject({ selected: 0, notSelected: 1 });
      clean(f);
    });
  },
);
