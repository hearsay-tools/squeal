import { realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/git-layout.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import type { AbsolutePath, RelativePath } from "../../src/core/types/common.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import type { Store } from "../../src/core/types/store.js";
import { type Fixture, fixture, git, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { result } from "../store/helpers.js";
import { check, clean, run, testOf, withStore } from "./status-at-kit.js";

/*
 * Row 023-19 (lessons P4, P5) on `$TMPDIR` git fixtures with the real
 * Vitest adapter. P4: a source path selects the test files whose closure
 * holds it, at the commit or now, as `squeal status <path>` does; a path
 * that selects nothing says so in `squeal status`'s words. P5: a live
 * daemon that has listed no test file yet, or not a file the commit lists,
 * never reads "the daemon lists no such test file" for a file the working
 * tree holds: the file is read at the working tree's keys.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const NEW = ref("test/new.test.ts");

/** A: `a.test.ts` reads `src/a.ts`; HEAD changes `src/a.ts` and adds `new.test.ts`, which reads it too. */
function sourced(): { f: Fixture; before: string } {
  const f = fixture({
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
    "src/lonely.ts": "export const value = 1;\n",
  });
  const before = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [NEW.path]: testOf("a", 2) });
  return { f, before };
}

type JsonFile = { project: string; path: string; at: { state: string }; now: { state: string } };
const paths = (out: string) => (JSON.parse(out).files as JsonFile[]).map((x) => x.path);

/** A live daemon in the fixture's worktree, with `rows` as its listing. */
function liveDaemon(f: Fixture, store: Store, rows: readonly TestFileRef[]): string {
  const id = worktreeIdFor(f.root);
  store.worktrees.upsert({
    id,
    root: f.root,
    commonDir: realpathSync(join(f.root, ".git")) as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: join(f.dir, "d.sock") as AbsolutePath,
      startedAt: Date.now(),
      heartbeatAt: Date.now(),
      heartbeatIntervalMs: 60_000,
      squealVersion: "0.0.0",
    },
  });
  store.testFileKeys.upsertMany(
    rows.map((testFile) => ({
      worktreeId: id,
      testFile,
      key: `daemon-${testFile.path}`,
      revision: 2,
      pending: null,
    })),
  );
  return id;
}

describe("status --at with a source path (row 023-19, P4)", SLOW, () => {
  it("selects the test files whose closure holds it, at the commit and now", async () => {
    const { f, before } = sourced();
    const json = await run(f, { commit: before, paths: ["src/a.ts"], json: true });
    expect(json.code).toBe(3);
    // `a.test.ts` reads it at both; `new.test.ts` only now; `plain.test.ts` never.
    expect(paths(json.out)).toEqual([TEST.path, NEW.path]);
    expect(JSON.parse(json.out).unmatched).toEqual([]);
    const files = JSON.parse(json.out).files as JsonFile[];
    expect(files[0]?.at.state).toBe("no result");
    expect(files[1]?.at.state).toBe("absent");
    const text = await run(f, { commit: before, paths: ["src/a.ts"] });
    expect(text.out).not.toContain("src/a.ts:");
    expect(text.out).not.toContain("no runner lists it");
    expect(text.out).toContain(`${TEST.path}: no result -> no result`);
    clean(f);
  });

  it("reads a path no test file's closure holds as squeal status says it, and exits 3", async () => {
    const { f, before } = sourced();
    const at = before.slice(0, 9);
    const text = await run(f, { commit: before, paths: ["src/lonely.ts"] });
    expect(text.code).toBe(3);
    expect(text.out).toContain(`no test file's closure holds src/lonely.ts, at ${at} or now\n`);
    expect(text.out).toContain(": 0 test files,");
    const json = await run(f, { commit: before, paths: ["src/lonely.ts"], json: true });
    expect(JSON.parse(json.out).files).toEqual([]);
    expect(JSON.parse(json.out).unmatched).toEqual(["src/lonely.ts"]);
    // A test file named beside it is still answered.
    const both = await run(f, { commit: before, paths: [PLAIN.path, "src/lonely.ts"], json: true });
    expect(paths(both.out)).toEqual([PLAIN.path]);
    clean(f);
  });

  it("selects by the daemon's stored closures now, as squeal status <path> does", async () => {
    const { f, before } = sourced();
    withStore(f, (store) => {
      const id = liveDaemon(f, store, [TEST, PLAIN, NEW]);
      for (const [file, read] of [
        [NEW, ["src/a.ts", NEW.path]],
        [PLAIN, ["src/plain.ts", PLAIN.path]],
      ] as const) {
        store.testFiles.put({
          testFile: file,
          closure: {
            testFile: file,
            paths: [...read] as RelativePath[],
            complete: true,
            method: CLOSURE_METHOD,
          },
          updatedAt: Date.now(),
          updatedBy: id,
        });
      }
      store.results.putMany([result(check(NEW.path), `daemon-${NEW.path}`, { worktreeId: id })]);
    });
    const json = await run(f, { commit: before, paths: ["src/a.ts"], json: true });
    // Now: the stored closure of `new.test.ts` holds it (`a.test.ts` has none stored);
    // at the commit: the checkout's closure of `a.test.ts`.
    expect(paths(json.out)).toEqual([TEST.path, NEW.path]);
    const files = JSON.parse(json.out).files as JsonFile[];
    expect(files[1]?.now.state).toBe("pass");
    clean(f);
  });
});

describe(
  "status --at while the daemon has not listed the test files (row 023-19, P5)",
  SLOW,
  () => {
    it("reads now at the working tree's keys when the daemon has listed nothing yet", async () => {
      const { f, before } = sourced();
      withStore(f, (store) => liveDaemon(f, store, []));
      const text = await run(f, { commit: before });
      expect(text.out).toContain(
        "This worktree's daemon has not listed its test files yet: now is the stored results at the working tree's keys.",
      );
      expect(text.out).not.toContain("the daemon lists no such test file");
      expect(text.out).toContain(`${TEST.path}: no result -> no result`);
      const json = await run(f, { commit: before, json: true });
      expect(JSON.parse(json.out).now).toEqual({ kind: "stored", why: "listing" });
      clean(f);
    });

    it("keys here the files a listing daemon does not list yet, and says how many", async () => {
      const { f, before } = sourced();
      withStore(f, (store) => liveDaemon(f, store, [PLAIN]));
      const text = await run(f, { commit: before });
      expect(text.out).toContain(
        "Now is this worktree's daemon at revision 2; 1 test file it has not listed is read at the working tree's keys.",
      );
      expect(text.out).not.toContain("the daemon lists no such test file");
      expect(text.out).toContain(`${TEST.path}: no result -> no result`);
      // Listed by neither the daemon nor the commit: not asked (a named path would ask it).
      expect(text.out).not.toContain(NEW.path);
      // The listed file is the daemon's: its key holds no result.
      expect(text.out).toContain(`${PLAIN.path}: no result -> no result`);
      const json = await run(f, { commit: before, json: true });
      expect(JSON.parse(json.out).now).toEqual({ kind: "daemon", revision: 2, late: 1 });
      const plain = (JSON.parse(json.out).files as JsonFile[]).find((x) => x.path === PLAIN.path);
      expect(plain?.now).toEqual({ state: "no result", key: `daemon-${PLAIN.path}` });
      clean(f);
    });
  },
);
