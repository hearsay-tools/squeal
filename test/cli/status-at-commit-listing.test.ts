import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fixture, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../daemon/helpers.js";
import { run } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/*
 * Row 023-64 (dogfood round 8 X1; spec 023 D4.9 in the commit daemon; the
 * coordinator chose "A"): in s1-09, `lint-ast-grep-1/2` list the tracked
 * folder `.ai/ast-grep/rules/`. The working tree had run them and recorded
 * that read when a narrowed `--run` asked the commit daemon, so its D4.9
 * check refused them, "not comparable (needs .ai/ast-grep/rules/)", while
 * in the other 9 sessions the first ask chose them before the read was
 * known, and they ran and compared. Now a folder whose names in the commit
 * worktree equal the names the commit tracks there is held, so the file
 * compares whenever its read was recorded; a folder with a name the commit
 * does not track still refuses (`status-at-commit-refused.test.ts`).
 */

const LISTS = ref("test/lists.test.ts");
const LINKED = ref("test/linked.test.ts");

type Side = { state: string; reason?: string };
const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === path)?.at;

/** A test that lists `folder` (from the test's own folder) and expects `count` names. */
const listing = (name: string, folder: string, count: number) =>
  [
    'import { readdirSync } from "node:fs";',
    'import { expect, it } from "vitest";',
    'import { value } from "../src/plain";',
    `it("${name}", () => expect(readdirSync(new URL("${folder}", import.meta.url)).length).toBe(${count} * value));`,
    "",
  ].join("\n");

describe(
  "a folder read the commit tracks as listed compares at the commit (row 023-64, X1)",
  SLOW,
  () => {
    it("runs a file whose recorded read lists a tracked folder, plain or through a tracked symlink, in a narrowed --run", {
      timeout: 240_000,
    }, async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        "src/plain.ts": "export const value = 1;\n",
        "test/fixtures/a.json": "{}\n",
        "test/fixtures/b.json": "{}\n",
        ".ai/rules/one.yml": "a: 1\n",
        [LISTS.path]: listing("lists", "./fixtures", 2),
        [LINKED.path]: listing("linked", "../.agents/rules", 1),
      });
      mkdirSync(join(f.root, ".agents"), { recursive: true });
      symlinkSync("../.ai/rules", join(f.root, ".agents/rules"));
      const a = f.commit({ "src/plain.ts": "export const value = 1; // a\n" });
      const b = f.commit({ "src/plain.ts": "export const value = 1; // b\n" });
      f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
      const real = realCommitDaemon(f.root);
      const options = { cacheRoot: f.cacheRoot, daemons: real.daemons };

      // The first commit's run records both folder reads.
      const ask = { json: true, run: { allMissing: true }, waitMs: 120_000 } as const;
      const first = await run(f, { commit: a, ...ask }, options);
      expect(atOf(first.out, LISTS.path), first.err).toMatchObject({ state: "pass" });
      expect(atOf(first.out, LINKED.path), first.err).toMatchObject({ state: "pass" });

      // The next commit's first ask already knows the reads: a narrowed --run still runs them.
      const narrowed = {
        commit: b,
        paths: [LISTS.path, LINKED.path],
        json: true,
        run: { allMissing: false },
        waitMs: 120_000,
      } as const;
      const second = await run(f, narrowed, options);
      expect(atOf(second.out, LISTS.path), second.err).toMatchObject({ state: "pass" });
      expect(atOf(second.out, LINKED.path), second.err).toMatchObject({ state: "pass" });
    });
  },
);
