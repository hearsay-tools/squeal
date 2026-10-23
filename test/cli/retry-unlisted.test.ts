import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { retryCommand } from "../../src/cli/retry.js";
import { readRetries } from "../../src/core/retry/index.js";
import { shellWord } from "../../src/core/text.js";
import {
  bootstrappedMetaKey,
  type CheckKey,
  type RevisionNumber,
  refinedMetaKey,
} from "../../src/core/types/index.js";
import { fakeRepo, seedStore } from "../status/helpers.js";

/*
 * Row 011-134 (gh-76, 011 C5): `squeal retry` on an existing file that may be
 * a test file, before the daemon lists the revision that holds it, says the
 * revision is not listed yet and names the named wait, with exit 3; a missing
 * path and a path no pattern selects keep their own refusals, exit 1; once
 * the revision is listed, the refusal stands as before.
 */

const KEYED = "test/a.test.ts";
const NEW = "test/new.test.ts";

const saved = { ...process.env };
let runtimeDir: string;
beforeEach(() => {
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

/**
 * A worktree with one keyed test file and revisions 1 to `latest`, the
 * runner part applied up to `refined`; `listedAt` is when `refined` was
 * recorded. No daemon listens.
 */
function worktree(latest: number, refined: number, listedAt: number) {
  const repo = fakeRepo();
  const store = seedStore(repo);
  const id = repo.mainId;
  store.worktrees.upsert({
    id,
    root: repo.main,
    commonDir: repo.commonDir,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.transaction(() => {
    for (let n = 1; n <= latest; n++) {
      store.revisions.append({
        worktreeId: id,
        createdAt: n === refined ? listedAt : n,
        head: "0000000000000000000000000000000000000000",
        dirty: true,
        trigger: "watch",
        changes: [{ path: "src/a.ts", oldHash: null, newHash: `h${n}` }],
      });
    }
  });
  store.meta.set(refinedMetaKey(id), String(refined));
  store.testFileKeys.upsertMany([
    {
      worktreeId: id,
      testFile: { project: "", path: KEYED as never },
      key: "key-a" as CheckKey,
      revision: refined as RevisionNumber,
      pending: null,
    },
  ]);
  const write = (path: string, text = "") => {
    mkdirSync(dirname(join(repo.main, path)), { recursive: true });
    writeFileSync(join(repo.main, path), text);
  };
  return { root: repo.main, store, id, write };
}

async function retry(argv: string[], cwd: string) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env: { CLAUDE_CODE_SESSION_ID: "s1" },
  };
  const code = await retryCommand(argv, io, { hostLoad: () => ({ oneMinute: 1, cpus: 8 }) });
  return { code, stdout, stderr };
}

const unlisted = (shown: string, clause: string, given = shown) =>
  `Not listed yet: ${shown} has no key because ${clause}, so it has nothing to retry; a new test file is queued once its revision is listed, without a retry. squeal status --wait 60000 ${shellWord(given)} waits for that listing and its result.\n`;

describe("squeal retry on a test file the daemon has not listed yet (011-134, gh-76)", () => {
  it("names the unlisted revision and the named wait, queues nothing, and exits 3", async () => {
    const w = worktree(4, 3, 3);
    w.write(NEW);
    const out = await retry([NEW], w.root);
    expect(out).toEqual({
      code: 3,
      stdout: unlisted(NEW, "revision 4 is not listed yet"),
      stderr: "",
    });
    expect(readRetries(w.store)).toEqual([]);
    // From a subdirectory the wait names the path as given, which resolves from there.
    const below = await retry(["new.test.ts", "--reason", "load"], join(w.root, "test"));
    expect(below.stdout).toBe(unlisted(NEW, "revision 4 is not listed yet", "new.test.ts"));
  });

  it("says the file changed after the newest listed revision when the daemon has not recorded it", async () => {
    // gh-76: a worktree at revision 0, listed by the daemon that started at `startedAt`.
    const w = worktree(0, 0, 0);
    w.store.meta.set(bootstrappedMetaKey(w.id), String(Date.now() - 60_000));
    w.write(NEW);
    const out = await retry([NEW, KEYED], w.root);
    expect(out.code).toBe(3);
    expect(out.stdout.split("\n")[0]).toBe(
      unlisted(NEW, "it changed after revision 0, the newest the daemon listed").trimEnd(),
    );
  });

  it("refuses a missing path as missing, exit 1, before any other line's exit 3", async () => {
    const w = worktree(4, 3, 3);
    w.write(NEW);
    const out = await retry(["test/gone.test.ts", NEW], w.root);
    expect(out.code).toBe(1);
    expect(out.stdout).toBe(
      `Not retried: test/gone.test.ts does not exist in this worktree.\n${unlisted(NEW, "revision 4 is not listed yet")}`,
    );
  });

  it("keeps the refusal for a path no configured pattern selects, before its listing too", async () => {
    const w = worktree(4, 3, 3);
    // A pytest project alone: no Vitest is built, so only the project's globs select.
    w.write(
      "squeal.config.json",
      JSON.stringify({ pytest: [{ name: "unit", cwd: "pkg", include: ["tests/**/test_*.py"] }] }),
    );
    w.write("pkg/tests/test_x.py");
    w.write("pkg/src/x.py");
    const out = await retry(["pkg/src/x.py", "pkg/tests/test_x.py"], w.root);
    expect(out.code).toBe(1);
    expect(out.stdout).toBe(
      `Not retried: pkg/src/x.py is not a test file Squeal has keyed in this worktree.\n${unlisted("pkg/tests/test_x.py", "revision 4 is not listed yet")}`,
    );
    // With Vitest built, a file policy `vitest.exclude` drops is no test file either.
    w.write("squeal.config.json", JSON.stringify({ vitest: { exclude: ["test/e2e/**"] } }));
    w.write("test/e2e/b.test.ts");
    expect((await retry(["test/e2e/b.test.ts"], w.root)).stdout).toBe(
      "Not retried: test/e2e/b.test.ts is not a test file Squeal has keyed in this worktree.\n",
    );
  });

  it("treats a file whose name starts with two dots as inside its project and the worktree (review 0.1.275 B1)", async () => {
    const w = worktree(4, 3, 3);
    w.write(
      "squeal.config.json",
      JSON.stringify({ nodeTest: [{ name: "pkg", cwd: "pkg", include: ["**/*.test.ts"] }] }),
    );
    w.write("pkg/..fresh.test.ts");
    expect(await retry(["pkg/..fresh.test.ts"], w.root)).toEqual({
      code: 3,
      stdout: unlisted("pkg/..fresh.test.ts", "revision 4 is not listed yet"),
      stderr: "",
    });
    // A root-level `..` name is in the worktree too; Vitest is built when no other project is.
    w.write("squeal.config.json", JSON.stringify({}));
    w.write("..root.test.ts");
    expect((await retry(["..root.test.ts"], w.root)).code).toBe(3);
  });

  it("is unchanged once a listed revision holds the file: the refusal stands", async () => {
    // The listed revision was recorded after the file last changed (its ctime).
    const w = worktree(3, 3, Date.now() + 60_000);
    w.write(NEW);
    const out = await retry([NEW], w.root);
    expect(out).toEqual({
      code: 1,
      stdout: `Not retried: ${NEW} is not a test file Squeal has keyed in this worktree.\n`,
      stderr: "",
    });
  });
});
