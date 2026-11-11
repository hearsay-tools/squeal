import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { storedFiles } from "../../src/cli/code-gate-stored.js";
import { startDaemon } from "../../src/core/daemon/daemon.js";
import type { CheckKey, TestFileRef } from "../../src/core/types/keys.js";
import { createFixtureRepo, type FixtureRepo, waitFor, withStore } from "../daemon/helpers.js";
import { git } from "../hash/git-repo.js";
import { gate, hasRecord, runIdsAt } from "./code-gate-keep-kit.js";

/*
 * Spec 020 D17.3 (row 020-17c): the gate's Vitest observes runtime reads as
 * the worktree's daemon does, so the key it keeps a file at holds what the
 * file reads outside its import graph. A daemon that observed that read
 * keys the file at the same key and reads the gate's result as current; a
 * run that reads a path its key lacks is not kept; once the read file
 * changes, neither the gate nor a daemon reads the kept result again.
 */

const SLOW = { timeout: 300_000 } as const;

const POLICY = (onStart: string) =>
  `${JSON.stringify({
    complexity: { enabled: true },
    coverage: { enabled: true },
    baseline: { onStart },
  })}\n`;

const READS = "test/reads.test.ts";
const REF: TestFileRef = { project: "", path: READS };

/** A test that reads `data/input.txt` at run time, which no import loads. */
const reads = (title: string) =>
  `import { readFileSync } from "node:fs";\nimport { expect, it } from "vitest";\n\nit(${JSON.stringify(title)}, () => {\n  expect(readFileSync(new URL("../data/input.txt", import.meta.url), "utf8")).toMatch(/^hello/);\n});\n`;

/** Its key as the worktree's daemon would give it now. */
async function keyNow(repo: FixtureRepo): Promise<CheckKey> {
  const stored = storedFiles(repo.root, repo.env, () => {});
  try {
    const key = (await stored?.keys([REF]))?.get(REF);
    if (key == null) throw new Error(`no key for ${READS}`);
    return key;
  } finally {
    await stored?.close();
  }
}

/** The worktree's key of the file as its daemon last stored it; `null` before it has one. */
function daemonKey(repo: FixtureRepo): CheckKey | null {
  return withStore(
    repo,
    (store) =>
      store.testFileKeys.list(repo.worktreeId).find((r) => r.testFile.path === READS)?.key ?? null,
  );
}

/** Runs a daemon in `repo` until `until` holds, then stops it. */
async function withDaemon<T>(repo: FixtureRepo, until: () => T | null, what: string): Promise<T> {
  const daemon = await startDaemon({ root: repo.root, env: repo.env });
  if ("reason" in daemon) throw new Error(daemon.message);
  try {
    await daemon.ready;
    return (await waitFor(until, 180_000, what)) as T;
  } finally {
    await daemon.stop("stop-requested");
  }
}

function write(repo: FixtureRepo, files: Readonly<Record<string, string>>): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo.root, path)), { recursive: true });
    writeFileSync(join(repo.root, path), text);
  }
}

describe("squeal code --base keeps a file at the key its daemon gives it, reads included", () => {
  let repo: FixtureRepo;

  beforeAll(() => {
    repo = createFixtureRepo({ files: { "squeal.config.json": POLICY("lookup-only") } });
    git(repo.root, ["checkout", "-q", "-b", "feature"]);
    write(repo, { "data/input.txt": "hello\n", [READS]: reads("reads its input") });
    git(repo.root, ["add", "-A"]);
    git(repo.root, ["commit", "-qm", "feature"]);
  });

  afterAll(() => repo?.cleanup());

  it("does not keep a run that read a path its key lacks", SLOW, async () => {
    const key = await keyNow(repo);

    const first = await gate(repo, []);

    expect(first.ran).toEqual([READS]);
    expect(first.report.runs[0]?.completed).toEqual([READS]);
    // No daemon observed the read yet: its key lacks `data/input.txt`, so the run is not its run.
    expect(runIdsAt(repo, key)).toEqual([]);
  });

  it(
    "keeps the run once a daemon observed the read, at the key that daemon gives",
    SLOW,
    async () => {
      // A daemon that runs every file observes the read and stores it for every worktree.
      write(repo, { "squeal.config.json": POLICY("lookup-then-run-missing") });
      const observed = await withDaemon(
        repo,
        () => {
          const key = daemonKey(repo);
          return key !== null && runIdsAt(repo, key).length > 0 ? key : null;
        },
        "the daemon's result of the reading test",
      );
      write(repo, {
        "squeal.config.json": POLICY("lookup-only"),
        [READS]: reads("reads it again"),
      });
      const key = await keyNow(repo);
      expect(key).not.toBe(observed);

      const kept = await gate(repo, []);

      expect(kept.ran).toEqual([READS]);
      const ids = runIdsAt(repo, key);
      expect(ids).toHaveLength(1);
      expect(ids[0]).toMatch(/^gate-/);
      expect(hasRecord(repo, key)).toBe(true);

      // A daemon started afterwards keys the file where the gate kept it and reads it as current.
      const states = await withDaemon(
        repo,
        () =>
          withStore(repo, (store) => {
            if (daemonKey(repo) !== key) return null;
            const found = store.knownStates.list(repo.worktreeId, [REF]);
            return found.length > 0 && found.every((s) => s.validity === "current") ? found : null;
          }),
        "the gate's result current at the daemon's key",
      );
      expect(states.map((s) => s.outcome)).toEqual(states.map(() => "pass"));
      expect(runIdsAt(repo, key)).toEqual(ids);
    },
  );

  it(
    "reads the kept result neither in the gate nor in a daemon once the read file changed",
    SLOW,
    async () => {
      const before = await keyNow(repo);
      expect(runIdsAt(repo, before)[0]).toMatch(/^gate-/);
      write(repo, { "data/input.txt": "hello, changed\n" });
      const after = await keyNow(repo);
      expect(after).not.toBe(before);

      const again = await gate(repo, []);
      expect(again.ran).toEqual([READS]);
      expect(again.report.runs[0]?.from).toBeUndefined();

      // A daemon keys the file at the new key too, so the result kept at the old one is not current.
      await withDaemon(repo, () => (daemonKey(repo) === after ? after : null), "the new key");
    },
  );
});
