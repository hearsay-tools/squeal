import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { squealEvidence } from "../../evals/lib/index.mjs";
import { type CliIo, main } from "../../src/cli/main.js";
import { selectNamedFiles } from "../../src/cli/named-selection.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { withStatusStore } from "../../src/core/status/index.js";
import { bootstrappedMetaKey, type Store } from "../../src/core/types/index.js";
import { check } from "../status/helpers.js";
import { type Answer, closeFakeDaemons, fakeDaemon } from "./fake-daemon.js";
import { A, B, fail, INCARNATION, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-206 (gh-83; 011 C15, 005 D2): a named path that is not a listed
 * test file is named as such after `Selected:` and in `selection.paths`. One
 * with a test file's name that no runner here lists is a test file Squeal
 * does not run: its readers stay selected, their verdict is not its own, and
 * with them passing the selection has none (`not-run`, exit 3). A source
 * path still selects its readers and gives their verdict.
 */

const saved = { ...process.env };
let runtimeDir: string;
const listening = new Set<string>();
beforeEach(() => {
  // Socket paths are limited to 108 bytes; the test temp dir can be longer.
  runtimeDir = mkdtempSync("/tmp/sq-");
  process.env.XDG_RUNTIME_DIR = runtimeDir;
});
afterEach(() => {
  closeFakeDaemons();
  listening.clear();
  rmSync(runtimeDir, { recursive: true, force: true });
  process.env = { ...saved };
});

const E2E = "test/e2e/task-cli.test.ts";
const SHARED = "src/shared.ts";
const NOT_RUN = `${E2E} is not a test file any runner here lists`;

/** `testFile`'s stored closure, written by this worktree. */
function closure(store: Store, by: string, testFile: string, paths: readonly string[]) {
  store.testFiles.put({
    testFile: ref(testFile),
    closure: {
      testFile: ref(testFile),
      paths: [testFile, ...paths].sort() as never,
      complete: false,
      method: CLOSURE_METHOD,
    },
    updatedAt: NOW,
    updatedBy: by,
  });
}

function write(root: string, path: string, text = "") {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}

/**
 * gh-83's shape: a Vitest config whose `include` only Vitest reads keeps
 * `E2E` out, and A and B read it and `SHARED`; the daemon listed the files
 * on disk after they were written.
 */
function covered() {
  const seeded = repoWith([], [A, B]);
  const { repo, store } = seeded;
  write(
    repo.main,
    "vitest.config.ts",
    'export default { test: { include: ["src/**/*.test.ts"] } };\n',
  );
  write(repo.main, E2E);
  write(repo.main, SHARED);
  for (const file of [A, B]) closure(store, repo.mainId, file, [E2E, SHARED]);
  store.meta.set(bootstrappedMetaKey(repo.mainId), String(Date.now() + 60_000));
  return seeded;
}

const synced: Answer = {
  ok: true,
  type: "sync",
  requestId: "y1",
  revision: 4,
  error: null,
  moves: true,
  incarnation: INCARNATION,
};

/** `status` in `cwd`, whose daemon answers that its pass is stored at revision 4. */
async function run(argv: string[], cwd: string) {
  if (!listening.has(cwd)) {
    listening.add(cwd);
    await fakeDaemon(socketPathFor(worktreeIdFor(cwd)), {
      sync: [synced],
      "sync-status": [synced],
    });
  }
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
    now: () => NOW,
    env: {},
  };
  const code = await main(argv, io);
  return { code, stdout, stderr, lines: stdout.trimEnd().split("\n") };
}

function paths(root: string, named: readonly string[]) {
  const read = withStatusStore(root, {}, ({ store, root: found }) =>
    selectNamedFiles(store, worktreeIdFor(found), found, found, named),
  );
  if ("available" in read) throw new Error(read.message);
  return read.paths;
}

describe("a named test file Squeal does not run (row 011-206, gh-83)", () => {
  it("is named not run, its readers selected apart, and leaves no verdict while they pass", async () => {
    const { repo } = covered();

    const text = await run(["status", E2E], repo.main);
    const json = await run(["status", "--json", E2E], repo.main);

    expect(text.code).toBe(3);
    expect(text.lines.slice(0, 3)).toEqual([
      "Revision: 4",
      `Selected: ${A}, ${B}`,
      `Not run by Squeal: ${NOT_RUN}; it selects the 2 test files that read it, whose verdict is not its own`,
    ]);
    expect(text.lines.at(-1)).toMatch(
      new RegExp(
        `^Named test files have no verdict: Squeal does not run ${E2E}, which is not a test file any runner here lists; the test files selected at revision 4: no known failures; 2 test files, each with a current result\\. Worktree: `,
      ),
    );
    expect(json.code).toBe(3);
    const { selection } = JSON.parse(json.stdout);
    expect(selection).toMatchObject({ code: 3, result: "none", reason: "not-run", unmatched: [] });
    expect(selection.paths).toEqual([{ path: E2E, kind: "not-run", selects: 2 }]);
    expect(selection.testFiles).toMatchObject([
      { path: A, state: "current", verdict: "pass" },
      { path: B, state: "current", verdict: "pass" },
    ]);
  });

  it("keeps the readers' failure as the selection's: exit 1, the path named beside it", async () => {
    const { repo, store } = covered();
    fail(store, repo.mainId, check(A, "holds"));

    const result = await run(["status", "--json", E2E], repo.main);

    expect(result.code).toBe(1);
    expect(JSON.parse(result.stdout).selection).toMatchObject({ result: "fail" });
    expect(result.stderr).toMatch(
      new RegExp(
        `\\nNamed test files at revision 4: 1 known failure: 1 test; 2 test files, each with a current result; Squeal does not run ${E2E}, `,
      ),
    );
  });

  it("says Squeal does not run one that no test file reads, in place of D2's unmatched text", async () => {
    const { repo } = covered();
    write(repo.main, "test/e2e/other.test.ts");

    const result = await run(["status", "--json", "test/e2e/other.test.ts"], repo.main);

    expect(result.code).toBe(3);
    const { selection } = JSON.parse(result.stdout);
    expect(selection).toMatchObject({ outcome: "snapshot", result: "none", reason: "not-run" });
    expect(selection.unmatched).toEqual(["test/e2e/other.test.ts"]);
    expect(result.stderr).toMatch(
      /^No verdict: Squeal does not run test\/e2e\/other\.test\.ts, which is not a test file any runner here lists\. /,
    );
  });

  it("reads a test file the daemon has not listed yet by what it selects, not as not run", () => {
    const { repo, store } = repoWith([], [A]);
    // No listing after the files were written: `notKeyed`'s reading of a revision not listed yet.
    write(repo.main, E2E);
    write(repo.main, "test/e2e/new.test.ts");
    closure(store, repo.mainId, A, [E2E]);

    expect(paths(repo.main, [E2E])).toEqual([{ path: E2E, kind: "source", selects: 1 }]);
    expect(paths(repo.main, ["test/e2e/new.test.ts"])).toEqual([
      { path: "test/e2e/new.test.ts", kind: "unmatched", selects: 0 },
    ]);
  });

  it("reads a file policy vitest.exclude keeps out as not run, whatever its name", () => {
    const { repo } = covered();
    write(
      repo.main,
      "squeal.config.json",
      JSON.stringify({ vitest: { exclude: ["test/e2e/**"] } }),
    );
    write(repo.main, "test/e2e/run.e2e.ts");

    expect(paths(repo.main, ["test/e2e/run.e2e.ts", A])).toEqual([
      { path: "test/e2e/run.e2e.ts", kind: "not-run", selects: 0 },
      { path: A, kind: "test-file", selects: 1 },
    ]);
  });
});

describe("a source path (row 011-206)", () => {
  it("still selects its readers and gives their verdict, named after Selected:, which the evals parser reads", async () => {
    const { repo } = covered();

    const result = await run(["status", SHARED], repo.main);
    const json = await run(["status", "--json", SHARED], repo.main);

    expect(result.code).toBe(0);
    expect(result.lines.slice(1, 3)).toEqual([
      `Selected: ${A}, ${B}`,
      `Not a listed test file: ${SHARED}; it selects the 2 test files that read it`,
    ]);
    expect(result.lines.at(-1)).toMatch(/^Named test files at revision 4: no known failures; /);
    expect(squealEvidence(result.stdout, "pull")?.selected).toEqual([A, B]);
    expect(JSON.parse(json.stdout).selection).toMatchObject({
      code: 0,
      result: "pass",
      paths: [{ path: SHARED, kind: "source", selects: 2 }],
    });
  });

  it("is not called not run in a pytest-only repository, where a test file's name is the project's include", () => {
    const { repo, store } = repoWith([], ["tests/test_foo.py"]);
    write(
      repo.main,
      "squeal.config.json",
      JSON.stringify({ pytest: [{ name: "unit", include: ["tests/test_*.py"] }] }),
    );
    write(repo.main, "src/foo.py");
    write(repo.main, "tests/test_bar.py");
    closure(store, repo.mainId, "tests/test_foo.py", ["src/foo.py", "tests/test_bar.py"]);
    store.meta.set(bootstrappedMetaKey(repo.mainId), String(Date.now() + 60_000));

    expect(paths(repo.main, ["src/foo.py", "tests/test_bar.py"])).toEqual([
      { path: "src/foo.py", kind: "source", selects: 1 },
      { path: "tests/test_bar.py", kind: "not-run", selects: 1 },
    ]);
  });
});
