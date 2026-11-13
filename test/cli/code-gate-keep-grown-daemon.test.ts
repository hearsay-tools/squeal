import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type RunningDaemon, startDaemon } from "../../src/core/daemon/daemon.js";
import { acquireDaemonLock } from "../../src/core/daemon/lock.js";
import { observedMetaKey, readSharedEntries } from "../../src/core/keys/observed.js";
import { lockFileFor } from "../../src/core/store/paths.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { type FixtureRepo, withStore } from "../daemon/helpers.js";
import { featureRepo, type Gate, gate, keepPolicy, write } from "./code-gate-keep-kit.js";

/*
 * Row 020-48 (spec 020 D17.3; #206, the shape of its probe): while a
 * daemon serves the worktree, `squeal code --base` keeps a file whose run
 * read a tracked path beyond its imports, `data/table.json`, at the key
 * with that read: the daemon merges the read into the shared observed row
 * and writes the file. The second run reads both selected files from the
 * stores, as it does where no daemon serves (row 020-39). A changed
 * `data/table.json` runs the reading file again; with no daemon then, the
 * run after that reads both from the stores again.
 */

const SLOW = { timeout: 300_000 } as const;

const READS: TestFileRef = { project: "", path: "test/reads.test.ts" };
const PLAIN: TestFileRef = { project: "", path: "test/plain.test.ts" };
const TABLE = "data/table.json";

const FEATURE: Readonly<Record<string, string>> = {
  "src/helper.ts": "export const helper = (x: number) => (x > 0 ? 1 : 0);\n",
  [TABLE]: '{ "rows": 1 }\n',
  [READS.path]: `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\nimport { helper } from "../src/helper.ts";\n\nit("reads the table", () => {\n  expect(helper(1)).toBe(1);\n  expect(readFileSync(new URL("../${TABLE}", import.meta.url), "utf8")).toMatch(/rows/);\n});\n`,
  [PLAIN.path]: `import { expect, it } from "vitest";\nimport { helper } from "../src/helper.ts";\n\nit("plain", () => {\n  expect(helper(0)).toBe(0);\n});\n`,
};

/** Each selected file's source in the run's report: `store`, else `run`. */
const fromOf = (run: Gate) => run.report.runs[0]?.from;

describe("squeal code --base while a daemon serves, a file that reads a tracked path (row 020-48, #206)", () => {
  let repo: FixtureRepo;
  let daemon: RunningDaemon | null = null;

  beforeAll(async () => {
    repo = featureRepo(keepPolicy("lookup-only"), FEATURE);
    const started = await startDaemon({ root: repo.root, env: repo.env });
    if ("reason" in started) throw new Error(started.message);
    daemon = started;
    await started.ready;
  }, SLOW.timeout);

  afterAll(async () => {
    await daemon?.stop("stop-requested");
    repo?.cleanup();
  });

  it(
    "is kept on the first run, and both files are read from the stores on the second",
    SLOW,
    async () => {
      // The daemon holds the worktree's lock, so the gate cannot write itself: the daemon writes.
      expect(acquireDaemonLock(lockFileFor(repo.commonDir, repo.worktreeId))).toBeNull();
      const first = await gate(repo, ["src/helper.ts"]);

      expect([first.code, [...first.ran].sort()]).toEqual([0, [PLAIN.path, READS.path]]);
      expect(first.stderr).not.toContain("was not kept in the stores");
      const rows = withStore(repo, (store) => readSharedEntries(store, observedMetaKey("")));
      expect(rows[READS.path]).toEqual(expect.arrayContaining([TABLE]));

      const second = await gate(repo, ["src/helper.ts"]);

      expect([second.code, second.ran]).toEqual([0, []]);
      expect(fromOf(second)).toEqual({ [PLAIN.path]: "store", [READS.path]: "store" });
    },
  );

  it(
    "runs the reading file again once the table changed, and keeps it with no daemon too",
    SLOW,
    async () => {
      // Stopped first, so no run of the daemon's own stores the file at its new key.
      await daemon?.stop("stop-requested");
      daemon = null;
      write(repo, { [TABLE]: '{ "rows": 2 }\n' });

      const changed = await gate(repo, ["src/helper.ts"]);

      expect([changed.code, changed.ran]).toEqual([0, [READS.path]]);
      expect(fromOf(changed)).toEqual({ [PLAIN.path]: "store", [READS.path]: "run" });
      expect(changed.stderr).not.toContain("was not kept in the stores");

      const again = await gate(repo, ["src/helper.ts"]);

      expect([again.code, again.ran]).toEqual([0, []]);
      expect(fromOf(again)).toEqual({ [PLAIN.path]: "store", [READS.path]: "store" });
    },
  );
});
