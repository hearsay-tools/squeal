import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { observedMetaKey } from "../../src/core/keys/index.js";
import { git } from "../hash/git-repo.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { createRepo, openRepoStore, SLOW } from "./helpers.js";
import { NT, open as openNodeTest } from "./preload-worktrees.js";

/*
 * Spec 016 D4, the written-directory bound (the human, 2026-10-25, O1 (b)),
 * through each runner: a git-ignored path a run loaded is kept unless the
 * same test file created, wrote or removed one of its ancestor directories,
 * `mkdtemp` included. A test's own scratch then never grows the observed set.
 */

const KEPT = "nt/test/kept.test.mjs";
const SCRATCH = "nt/test/scratch.test.mjs";

/** A repository whose files `committed` are committed, `ignored` written after a `.gitignore` of `dist/` and `.tmp/`. */
function repoWith(committed: Record<string, string>, ignored: Record<string, string>) {
  const repo = createRepo("basic");
  const write = (files: Record<string, string>) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo.main, path)), { recursive: true });
      writeFileSync(join(repo.main, path), text);
    }
  };
  write({ ".gitignore": "dist/\n.tmp/\n", ...committed });
  git(repo.main, ["add", "-A"]);
  git(repo.main, ["commit", "-qm", "files"]);
  write(ignored);
  return repo;
}

describe(
  "scheduler: git-ignored observed paths (016 D4, the written-directory bound)",
  SLOW,
  () => {
    it("node:test: keeps an ignored module a test loads, drops one below its mkdtemp directory", async () => {
      const repo = repoWith(
        {
          "nt/package.json": `${JSON.stringify({ name: "nt", private: true, type: "module" })}\n`,
          [KEPT]: [
            `import assert from "node:assert/strict";`,
            `import { test } from "node:test";`,
            `const target = "../dist/x" + ".mjs";`,
            `test("loads a built module", async () => assert.equal((await import(target)).x, 1));`,
            "",
          ].join("\n"),
          [SCRATCH]: [
            `import assert from "node:assert/strict";`,
            `import { mkdtempSync, writeFileSync } from "node:fs";`,
            `import { join, resolve } from "node:path";`,
            `import { test } from "node:test";`,
            `import { pathToFileURL } from "node:url";`,
            `test("loads a module it wrote", async () => {`,
            `  const dir = mkdtempSync(join(".tmp", "u-"));`,
            `  writeFileSync(join(dir, "m.mjs"), "export const m = 1;\\n");`,
            `  assert.equal((await import(pathToFileURL(resolve(dir, "m.mjs")).href)).m, 1);`,
            `});`,
            "",
          ].join("\n"),
        },
        { "nt/dist/x.mjs": "export const x = 1;\n", "nt/.tmp/.keep": "" },
      );
      const store = openRepoStore(repo.commonDir);
      const open = () =>
        openNodeTest(repo.main, store, repo.commonDir, undefined, NT, undefined, RUN_MISSING);
      const side = await open();
      await side.scheduler.start();
      await side.scheduler.idle();
      expect(JSON.parse(store.meta.get(observedMetaKey(NT.name)) ?? "{}")).toEqual({
        [KEPT]: ["nt/dist/x.mjs"],
      });
      const ran = side.runs.flat().map((f) => f.path);
      expect(ran.filter((p) => p === SCRATCH)).toHaveLength(1);
      await side.scheduler.close();

      // A restart: the kept path keys the file, which inherits its own pass; nothing grew.
      const again = await open();
      await again.scheduler.start();
      await again.scheduler.idle();
      expect(again.runs).toEqual([]);
      expect(JSON.parse(store.meta.get(observedMetaKey(NT.name)) ?? "{}")).toEqual({
        [KEPT]: ["nt/dist/x.mjs"],
      });
    });
  },
);
