import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, runCommit } from "./status-at-kit.js";

/*
 * Row 023-18 D1 (`tasks/023-09-notes.md`): a file whose run reads a path its
 * static closure lacks is kept at the key with that read (020 row 020-39),
 * not at the key the keying gave before the run. `--run`'s report reads each
 * run file at the key its result was stored under, so it says "stored" and
 * names the key the next `--at` gives.
 */

const TEST = ref("test/a.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Reads `data/a.txt` at run time, through `fs`, not through an import. */
const reading = (value: number) =>
  [
    'import { readFileSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    'const data = readFileSync(new URL("../data/a.txt", import.meta.url), "utf8").trim();',
    `it("value", () => { expect(value).toBe(${value}); expect(data).toBe("a"); });`,
    "",
  ].join("\n");

interface Row {
  readonly path: string;
  readonly at: { state: string; key?: string; origin?: { kind: string; stored?: boolean } };
}
const rowOf = (out: string) => (JSON.parse(out).files as Row[]).find((f) => f.path === TEST.path);

describe(
  "squeal status --at --run reads each run file at its stored key (row 023-18 D1)",
  SLOW,
  () => {
    it("says stored, with the key the next --at reads it at", async () => {
      const f = fixture({
        ...ON,
        "src/a.ts": "export const value = 1;\n",
        "data/a.txt": "a\n",
        [TEST.path]: reading(1),
      });
      const a = git(f.root, "rev-parse", "HEAD").trim();
      f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: reading(2) });
      const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };

      // Row 023-40: the in-call run at its boundary, until row 023-41 removes it.
      const first = await runCommit(
        f,
        { commit: a, run: { allMissing: false, timeoutSeconds: 600 } },
        options,
      );
      const report = JSON.parse(first.out);
      expect(report.run, first.err).toMatchObject({ selected: 1, ran: 1, stored: 1 });
      const ran = rowOf(first.out);
      expect(ran?.at).toMatchObject({ state: "pass", origin: { kind: "run", stored: true } });
      expect(ran?.at).not.toHaveProperty("origin.notStored");
      clean(f);

      const second = await run(f, { commit: a, json: true }, options);
      const read = rowOf(second.out);
      expect(read?.at.state).toBe("pass");
      expect(read?.at.origin?.kind).not.toBe("run");
      expect(ran?.at.key).toBe(read?.at.key);
      clean(f);
    });
  },
);
