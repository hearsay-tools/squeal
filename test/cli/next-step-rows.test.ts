import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { fileEntry } from "../../src/cli/named-file-lines.js";
import { retryCommand } from "../../src/cli/retry.js";
import { CLOSURE_METHOD } from "../../src/core/keys/closure.js";
import { readRetries } from "../../src/core/retry/index.js";
import { AWAITING_INSTALL_REASON } from "../../src/core/scheduler/install.js";
import {
  awaitingInstallMetaKey,
  awaitingInstallValue,
  type CheckKey,
  installCommandMetaKey,
  type RevisionNumber,
  type Store,
} from "../../src/core/types/index.js";
import { check, state } from "../status/helpers.js";
import { BUSY, config, doneKey, marked, named, waited } from "./next-step-seed.js";
import { A, key, NOW, ref, repoWith } from "./status-wait-fixture.js";

/*
 * Row 011-27 (011 C15 as amended 2026-10-20; design 011-24 section 3): each
 * selected file without a current result names what advances it, one test
 * per row of the table, here the rows of a file that is `stale` or
 * `unknown`, the order rule and an unmatched path. The pending rows are in
 * `next-step-pending.test.ts`.
 */

const T = "tests/a.test.ts";
const U = "src/u.test.ts";

/** A worktree whose `paths` are keyed with nothing queued and no result. */
function keyed(...paths: string[]) {
  const { repo, store } = repoWith([]);
  for (const path of paths) key(store, repo.mainId, path, null);
  return { repo, store, id: repo.mainId };
}

describe("a stale or unknown selected file names what advances it (011-27)", () => {
  it("gh-38 A: a stale file under lookup-only, selected by a source path, names its retry", async () => {
    const { repo, store, id } = keyed(T);
    config(repo.main, { baseline: { onStart: "lookup-only" } });
    store.knownStates.upsertMany([
      state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
    ]);
    store.testFiles.put({
      testFile: ref(T),
      closure: {
        testFile: ref(T),
        paths: ["src/lib.js", T] as never,
        complete: false,
        method: CLOSURE_METHOD,
      },
      updatedAt: NOW,
      updatedBy: id,
    });

    const { wait, lines } = await waited(repo.main, ["src/lib.js"]);

    expect(wait.outcome).toBe("settled");
    expect(lines.slice(lines.indexOf(`Selected: ${T}`))).toEqual([
      `Selected: ${T}`,
      // Row 011-206 (gh-83): the source path is named apart from the files it selects.
      "Not a listed test file: src/lib.js; it selects the 1 test file that reads it",
      "Stale (1):",
      `  1 last passed at other inputs, nothing queued it (the baseline is lookup-only): ${T}; \`squeal retry ${T}\` runs it once`,
      expect.stringMatching(
        /^Named test files have no verdict: 1 test file without a current result at revision 4 \(1 stale\): 1 stale, nothing queued it: `squeal retry tests\/a\.test\.ts`\. Worktree: /,
      ),
    ]);
  });

  it("never run at its inputs, nothing queued: retry runs it once, in text and in JSON", () => {
    const { repo, store, id } = keyed(U);

    const { lines, groups, entries } = named(store, id, repo.main, [U]);

    expect(lines).toEqual([
      "Unknown (1):",
      `  1 never run at its inputs, nothing queued it (the baseline is lookup-only): ${U}; \`squeal retry ${U}\` runs it once`,
    ]);
    expect(groups).toBe(`1 never run, nothing queued it: \`squeal retry ${U}\``);
    expect(entries[0]).toMatchObject({
      next: `\`squeal retry ${U}\` runs it once`,
      command: `squeal retry ${U}`,
    });
  });

  it("four never-run files name <test file>... and how many files run --all runs (Q5)", () => {
    const paths = ["src/f1.test.ts", "src/f2.test.ts", "src/f3.test.ts", "src/f4.test.ts"];
    const { repo, store, id } = keyed(...paths);

    expect(named(store, id, repo.main, paths).lines[1]).toBe(
      `  4 never run at their inputs, nothing queued them (the baseline is lookup-only): ${paths.join(", ")}; \`squeal retry <test file>...\` runs each once, \`squeal run --all --wait\` runs all 4 test files not current here`,
    );
  });

  it("gh-43: timed out in a tier of its own, by its recorded cause, with the load at or above the CPU count", () => {
    const { repo, store, id } = keyed(U);
    marked(store, id, U, "timed out after 600 s", { cause: "timeout" });

    const { lines, groups } = named(store, id, repo.main, [U], BUSY);

    expect(lines[1]).toBe(
      `  1 timed out after 600 s; Squeal does not run it again at these inputs by itself: ${U}; \`squeal retry ${U}\` runs it once (load average 30.20 on 24 CPUs now: under that load it may time out again)`,
    );
    expect(groups).toBe(`1 timed out after 600 s: \`squeal retry ${U}\``);
    // Below the CPU count the load is not named.
    expect(named(store, id, repo.main, [U]).lines[1]).toMatch(/runs it once$/);
  });

  it("a record without a cause, an older daemon's, is matched by no words: the generic retry", () => {
    const { repo, store, id } = keyed(U);
    marked(store, id, U, "timed out after 600 s");

    expect(named(store, id, repo.main, [U], BUSY).lines[1]).toBe(
      `  1 no result: timed out after 600 s: ${U}; \`squeal retry ${U}\` runs it once`,
    );
  });

  it("ran and recorded nothing: the recorded reason, retry runs it once", () => {
    const { repo, store, id } = keyed(U);
    marked(store, id, U, "3 runs in a row read paths no earlier run had read", { ran: true });

    expect(named(store, id, repo.main, [U]).lines[1]).toBe(
      `  1 ran, nothing recorded: 3 runs in a row read paths no earlier run had read: ${U}; \`squeal retry ${U}\` runs it once`,
    );
  });

  it("its project's global setup failed: the next edit or run --all starts the runner again", () => {
    const { repo, store, id } = keyed(U);
    store.knownStates.upsertMany([
      state(
        id,
        { kind: "setup", project: "", testPath: "e2e/setup.ts" as never },
        { outcome: "fail" },
      ),
    ]);

    const { lines, groups } = named(store, id, repo.main, [U]);

    expect(lines[1]).toBe(
      `  1 its project's global setup failed: ${U}; the next edit or \`squeal run --all --wait\` starts the runner again`,
    );
    expect(groups).toBe("1 its project's global setup failed: `squeal run --all --wait`");
  });

  it("no key, a runner call failed: the next edit or run --all calls the runner again", () => {
    const { repo, store, id } = keyed();
    unkeyed(store, id, U);

    expect(named(store, id, repo.main, [U]).lines[1]).toBe(
      `  1 no key: its project's environment or closure is not known (a runner call failed), or a closure path is untracked: ${U}; the next edit or \`squeal run --all --wait\` calls the runner again`,
    );
  });

  it("no dependencies installed: the header's install command installs them", () => {
    const { repo, store, id } = keyed();
    unkeyed(store, id, U);
    marked(store, id, U, AWAITING_INSTALL_REASON, { cause: "install", key: null });
    store.meta.set(awaitingInstallMetaKey(id), awaitingInstallValue(["."]));
    store.meta.set(installCommandMetaKey(id), "npm ci");

    const { lines, entries } = named(store, id, repo.main, [U]);

    expect(lines[1]).toBe(
      `  1 no dependencies are installed in this worktree: ${U}; \`npm ci\` installs them`,
    );
    expect(entries[0]?.command).toBe("npm ci");
  });

  it("the order rule: a stale file whose key another live worktree runs names the claim, not retry", () => {
    const { repo, store, id } = keyed(T);
    store.knownStates.upsertMany([
      state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
    ]);
    const other = repo.addWorktree("other");
    store.worktrees.upsert({
      id: other.id,
      root: other.root,
      commonDir: repo.commonDir,
      isMain: false,
      registeredAt: 2,
      daemon: {
        socketPath: "/tmp/other.sock",
        startedAt: NOW - 60_000,
        heartbeatAt: NOW - 1_000,
        heartbeatIntervalMs: 5_000,
        squealVersion: "0.0.0-test",
      },
    });
    store.testFileKeys.upsertMany([
      {
        worktreeId: other.id,
        testFile: ref(T),
        key: doneKey(T),
        revision: 1 as never,
        pending: "running",
      },
    ]);

    const { lines, groups, entries } = named(store, id, repo.main, [T]);

    expect(lines).toEqual([
      "Stale (1):",
      expect.stringMatching(
        new RegExp(
          `^ {2}1 waiting for ${other.root}'s run of its key, at most until \\d\\d:\\d\\d:\\d\\d: ${T}; its result is shared here when that run stores it$`,
        ),
      ),
    ]);
    expect(groups).not.toContain("retry");
    expect(entries[0]).not.toHaveProperty("command");
  });

  it("from a subdirectory, each command names its paths from there, and following it retries each file at its key (review of cand/0.1.231, B1)", async () => {
    const N = "tests/n.test.ts";
    const { repo, store, id } = keyed(T, N, U);
    store.knownStates.upsertMany([
      state(id, check(T, "holds"), { validity: "stale", observedAt: 1 }),
      state(id, check(U, "holds"), { validity: "stale", observedAt: 1 }),
    ]);
    const cwd = join(repo.main, "tests");
    mkdirSync(cwd, { recursive: true });

    const { wait, lines } = await waited(cwd, ["a.test.ts", "n.test.ts", "../src/u.test.ts"]);

    // The stale files and the never-run one, each group's command from tests/.
    expect(wait.selection.base).toBe("tests");
    expect(lines).toContain(
      `  2 last passed at other inputs, nothing queued them (the baseline is lookup-only): ${T}, ${U}; \`squeal retry a.test.ts ../src/u.test.ts\` runs each once`,
    );
    expect(lines).toContain(
      `  1 never run at its inputs, nothing queued it (the baseline is lookup-only): ${N}; \`squeal retry n.test.ts\` runs it once`,
    );
    expect(lines.at(-1)).toContain("`squeal retry a.test.ts ../src/u.test.ts`");
    expect(lines.at(-1)).toContain("`squeal retry n.test.ts`");
    const commands = wait.files.map((f) => fileEntry(f, "squeal", wait.selection.base).command);
    expect(commands).toEqual([
      "squeal retry a.test.ts",
      "squeal retry n.test.ts",
      "squeal retry ../src/u.test.ts",
    ]);

    const runtime = mkdtempSync("/tmp/sq-");
    const saved = process.env.XDG_RUNTIME_DIR;
    process.env.XDG_RUNTIME_DIR = runtime;
    try {
      const io: CliIo = {
        stdout: () => {},
        stderr: () => {},
        cwd,
        env: { CLAUDE_CODE_SESSION_ID: "s1" },
      };
      const load = { hostLoad: () => ({ oneMinute: 1, cpus: 8 }) };
      // Each JSON command as printed, run from the same directory.
      for (const command of commands) {
        const argv = (command ?? "").split(" ").slice(2);
        expect(await retryCommand(argv, io, load), command ?? "").toBe(0);
      }
      expect(readRetries(store)).toMatchObject(
        [T, N, U].map((path) => ({ testFile: ref(path), key: doneKey(path), noResult: true })),
      );
    } finally {
      if (saved === undefined) delete process.env.XDG_RUNTIME_DIR;
      else process.env.XDG_RUNTIME_DIR = saved;
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  it("gh-39: an unmatched path names the directory it was resolved against and the root's test file", async () => {
    const { repo } = repoWith([], [A]);
    mkdirSync(join(repo.main, "src"), { recursive: true });

    const { wait, lines } = await waited(join(repo.main, "src"), [A]);

    expect(wait.outcome).toBe("unmatched");
    expect(lines.at(-1)).toMatch(
      /^No verdict: no test file's closure holds src\/src\/a\.test\.ts \(src\/a\.test\.ts, resolved against src\); from the worktree root that path is the listed test file src\/a\.test\.ts\. Worktree: /,
    );
    expect(wait.selection.unmatched).toEqual(["src/src/a.test.ts"]);
  });

  it("no daemon validating: `squeal start` starts one", async () => {
    const { repo, store, id } = keyed(U);
    const row = store.worktrees.get(id);
    if (row === null) throw new Error("no worktree");
    store.worktrees.upsert({ ...row, daemon: null });

    const { wait, lines } = await waited(repo.main, [U]);

    expect(wait.outcome).toBe("no-daemon");
    expect(lines.at(-1)).toMatch(
      /^Named test files have no verdict: .*; results are as of revision 4; `squeal start` starts one\. Worktree: /,
    );
  });
});

/** `path`'s row with no key, as a failed runner call leaves it. */
function unkeyed(store: Store, worktreeId: string, path: string) {
  store.testFileKeys.upsertMany([
    {
      worktreeId,
      testFile: ref(path),
      key: null as CheckKey | null,
      revision: 4 as RevisionNumber,
      pending: null,
    },
  ]);
}
