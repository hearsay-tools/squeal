import { describe, expect, it } from "vitest";
import { fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { prove } from "./proof-kit.js";
import { run } from "./status-at-kit.js";
import { realCommitDaemon } from "./status-at-real-daemon.js";

/*
 * Row 023-47: the readers at HEAD after a proof whose control run (P9, no
 * condition, stored) ran a test that reads `data/a.txt` and rewrites it at
 * the base commit A (HEAD is B, then a later commit leaves its inputs as
 * they are). Before the fix, that run was kept at the key the test
 * has at both commits before any run, and its read was not recorded, so
 * every reader at HEAD keyed it alike (D2) and read A's failure. Now the
 * run is not kept and its read is recorded: `status --at HEAD` from the
 * store, and a daemon in a worktree at B (`--run`), never read a fail.
 */

const TEST = ref("test/a.test.ts");
const MUTATES = [
  'import { readFileSync, writeFileSync } from "node:fs";',
  'import { expect, it } from "vitest";',
  'it("value", () => {',
  '  const path = new URL("../data/a.txt", import.meta.url);',
  '  const got = readFileSync(path, "utf8").trim();',
  '  if (got === "1") writeFileSync(path, "2\\n");',
  '  expect(got).toBe("2");',
  "});",
  "",
].join("\n");

type Side = { state: string };
const atOf = (out: string, path: string) =>
  (JSON.parse(out).files as { path: string; at: Side }[]).find((x) => x.path === path)?.at;

describe(
  "readers at HEAD after a control run that rewrote its first-seen input (row 023-47)",
  SLOW,
  () => {
    it("status --at HEAD and a daemon at HEAD read no failure from the base commit's run", {
      timeout: 300_000,
    }, async () => {
      const f = fixture({
        "squeal.config.json": "{}\n",
        "data/a.txt": "1\n",
        [TEST.path]: MUTATES,
      });
      const base = git(f.root, "rev-parse", "HEAD").trim();
      const head = f.commit({ "data/a.txt": "2\n" });
      const env = [{ name: "PROOF_UNUSED", value: null }];
      const args = {
        files: [TEST.path],
        base,
        case: "source",
        source: ["data/a.txt"],
        env,
      } as const;
      const result = await prove(f, args);
      expect(result.files[0], result.why).toMatchObject({ verdict: "proven" });

      // `status --at` refuses the clean tree's own HEAD: a later commit leaves the test's inputs as they are.
    f.commit({ "notes.md": "later\n" });
    const stored = await run(f, { commit: head, json: true });
      expect(atOf(stored.out, TEST.path)?.state, stored.out + stored.err).not.toBe("fail");

      const real = realCommitDaemon(f.root);
      const ran = await run(
        f,
        { commit: head, json: true, run: { allMissing: true }, waitMs: 120_000 },
        { cacheRoot: f.cacheRoot, daemons: real.daemons },
      );
      expect(atOf(ran.out, TEST.path), ran.out + ran.err).toMatchObject({ state: "pass" });
    });
  },
);
