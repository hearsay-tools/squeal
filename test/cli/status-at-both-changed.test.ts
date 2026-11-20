import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run } from "./status-at-kit.js";

/*
 * Review wave-18 re-review blocker 2 (row 023-29), the reviewer's probe on
 * a `$TMPDIR` git fixture with the real Vitest adapter, no daemon, both
 * sides. At the commit the test rewrites tracked `src/a.ts` once and then
 * hangs, so the commit side's first pass ends no file; the working tree
 * passes; the commit side's second pass, after the working tree's turn,
 * runs on the changed checkout. That pass must not read as the commit's
 * result: the whole-checkout check runs before it, as before any later
 * child in that checkout, and its outcome is not comparable.
 */

const TEST = ref("test/a.test.ts");

/** Reads `value`; at 1, the first time, writes `src/a.ts` to 2 and waits for ever. */
const rewrites = (mark: string) =>
  [
    'import { existsSync, writeFileSync } from "node:fs";',
    'import { join } from "node:path";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/a";',
    'it("value", async () => {',
    `  if (value === 1 && !existsSync(${JSON.stringify(mark)})) {`,
    '    writeFileSync(join(process.cwd(), "src/a.ts"), "export const value = 2;\\n");',
    `    writeFileSync(${JSON.stringify(mark)}, "");`,
    "    await new Promise(() => {});",
    "  }",
    "  expect(value).toBe(2);",
    "}, 600_000);",
    "",
  ].join("\n");

describe(
  "a changed checkout across the commit side's passes (review wave-18 re-review 2)",
  SLOW,
  () => {
    it("never reads the second pass on a changed checkout as the commit's pass", async () => {
      const marks = mkdtempSync(join(tmpdir(), "squeal-rr2-"));
      const f = fixture({
        "squeal.config.json": "{}\n",
        "src/a.ts": "export const value = 1;\n",
        [TEST.path]: rewrites(join(marks, "rewrote")),
      });
      const base = git(f.root, "rev-parse", "HEAD").trim();
      f.commit({ "src/a.ts": "export const value = 2;\n" });
      const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };
      const json = await run(
        f,
        { commit: base, json: true, run: { allMissing: false, timeoutSeconds: 70 } },
        options,
      );
      const value = JSON.parse(json.out);
      const file = (value.files as { path: string; at: Record<string, unknown> }[]).find(
        (x) => x.path === TEST.path,
      );
      // Two commit passes: the first cut at its share, the second after the working tree's turn.
      expect(value.run.batches.length).toBe(2);
      expect(value.run).toMatchObject({ changed: "src/a.ts", changedBy: "run" });
      expect(file?.at.state).not.toBe("pass");
      expect(file?.at).toMatchObject({ state: "not comparable", ran: "pass" });
      expect(value.run.now).toMatchObject({ ran: 1 });
      // Nothing from the changed checkout is stored: the next call has no result at the commit.
      const next = await run(f, { commit: base, json: true }, options);
      const again = (JSON.parse(next.out).files as { path: string; at: { state: string } }[]).find(
        (x) => x.path === TEST.path,
      );
      expect(again?.at.state).toBe("no result");
      clean(f);
      rmSync(marks, { recursive: true, force: true });
    });
  },
);
