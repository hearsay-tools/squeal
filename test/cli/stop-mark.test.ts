import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CliIo } from "../../src/cli/main.js";
import { stopCommand } from "../../src/cli/stop.js";
import { socketPathFor } from "../../src/core/daemon/index.js";
import { stoppedMetaKey, treePrint } from "../../src/core/delivery/stopped.js";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import { isStoreOpenFailure, openStore, storePaths } from "../../src/core/store/index.js";
import type { AbsolutePath } from "../../src/core/types/index.js";
import { runHook } from "../../src/harness/claude-code/index.js";
import { recorded } from "../harness/helpers.js";
import { recording, text } from "../harness/stopped-repo.js";
import { git } from "../hash/git-repo.js";
import { noDaemonLine, stoppedLine } from "./stop-lines.js";

/*
 * Task 011-08 (gh-22, C9): once no daemon serves, `squeal stop` leaves the
 * worktree's stopped mark with the tree as git prints it, whether it stopped
 * a daemon or found none; with no store it writes none and creates none.
 * Row 011-254: `--until-start` marks it so, and creates the store where a
 * policy file says the repository uses Squeal.
 */

const saved = { ...process.env };
let dir: string;
const servers: Server[] = [];

beforeEach(() => {
  dir = realpathSync(mkdtempSync("/tmp/sq-"));
  process.env.XDG_RUNTIME_DIR = dir;
});

afterEach(() => {
  for (const s of servers.splice(0)) s.close();
  rmSync(dir, { recursive: true, force: true });
  process.env = { ...saved };
});

function checkout(): AbsolutePath {
  const root = join(dir, "repo");
  mkdirSync(root);
  git(root, ["init", "-q"]);
  writeFileSync(join(root, "a.txt"), "a\n");
  git(root, ["add", "a.txt"]);
  git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "a"]);
  return root as AbsolutePath;
}

/** The store with the worktree's row, as a daemon leaves it. */
function withStore(root: AbsolutePath): void {
  const store = openStore(join(root, ".git") as AbsolutePath);
  if (isStoreOpenFailure(store)) throw new Error("no store");
  store.worktrees.upsert({
    id: worktreeIdFor(root),
    root,
    commonDir: join(root, ".git") as AbsolutePath,
    isMain: true,
    registeredAt: 1,
    daemon: null,
  });
  store.close();
}

function mark(root: AbsolutePath): { at: number; tree: string | null; untilStart?: true } | null {
  const store = openStore(join(root, ".git") as AbsolutePath, { create: false });
  if (isStoreOpenFailure(store)) return null;
  try {
    const text = store.meta.get(stoppedMetaKey(worktreeIdFor(root)));
    return text === null ? null : JSON.parse(text);
  } finally {
    store.close();
  }
}

/** A stand-in daemon that answers ping and stop, and closes its socket on stop. */
function fakeDaemon(root: AbsolutePath): Promise<void> {
  return new Promise((resolve) => {
    const server = createServer((socket) => {
      socket.once("data", (data) => {
        const { type } = JSON.parse(data.toString()) as { type: string };
        const ping = { pid: 2 ** 22 + 1, startedAt: 1, worktreeId: worktreeIdFor(root), root };
        const answer = { schemaVersion: 1, ok: true, type, ...(type === "ping" ? ping : {}) };
        socket.end(`${JSON.stringify(answer)}\n`);
        if (type === "stop") server.close();
      });
    });
    servers.push(server);
    server.listen(socketPathFor(worktreeIdFor(root)), () => resolve());
  });
}

async function stop(root: AbsolutePath, args: string[] = []) {
  let stdout = "";
  let stderr = "";
  const io: CliIo = {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd: root,
    now: () => 5_000,
  };
  const code = await stopCommand(args, io);
  return { code, stdout, stderr };
}

describe("squeal stop leaves the stopped mark (task 011-08, #22)", () => {
  it("after the daemon it stopped is gone", async () => {
    const root = checkout();
    withStore(root);
    await fakeDaemon(root);

    expect(await stop(root)).toEqual({
      code: 0,
      stdout: stoppedLine(root),
      stderr: "",
    });
    expect(mark(root)).toEqual({ at: 5_000, tree: await treePrint(root) });
  });

  it("when it finds no daemon", async () => {
    const root = checkout();
    withStore(root);
    writeFileSync(join(root, "a.txt"), "edited\n");

    expect((await stop(root)).stdout).toBe(noDaemonLine(root));
    const left = mark(root);
    expect(left?.tree).toEqual(expect.any(String));
    expect(left?.tree).toBe(await treePrint(root));
  });

  it("writes none, and creates no store, where none exists", async () => {
    const root = checkout();
    expect((await stop(root)).code).toBe(0);
    expect(existsSync(storePaths(join(root, ".git") as AbsolutePath).database)).toBe(false);
  });
});

describe("squeal stop --until-start (row 011-254, gh-104)", () => {
  it("leaves a mark only `squeal start` ends, after the daemon it stopped is gone", async () => {
    const root = checkout();
    withStore(root);
    await fakeDaemon(root);

    expect(await stop(root, ["--until-start"])).toEqual({
      code: 0,
      stdout: stoppedLine(root, true),
      stderr: "",
    });
    expect(mark(root)).toEqual({ at: 5_000, tree: await treePrint(root), untilStart: true });
  });

  it("takes the flag after an explicit root too, and refuses anything else", async () => {
    const root = checkout();
    withStore(root);

    expect((await stop(root, [root, "--until-start"])).stdout).toBe(noDaemonLine(root, true));
    expect(await stop(root, ["--until-start", root, root])).toEqual({
      code: 2,
      stdout: "",
      stderr: "usage: squeal stop [--until-start] [root]\n",
    });
    expect((await stop(root, ["--until"])).code).toBe(2);
  });

  it("creates the store with the mark alone where a policy file and no store exist, and SessionStart spawns no daemon", async () => {
    const root = checkout();
    writeFileSync(join(root, "squeal.config.json"), "{}\n");
    const database = storePaths(join(root, ".git") as AbsolutePath).database;
    expect(existsSync(database)).toBe(false);

    expect((await stop(root, ["--until-start"])).stdout).toBe(noDaemonLine(root, true));
    expect(rowsOf(database)).toEqual([{ table: "meta", key: stoppedMetaKey(worktreeIdFor(root)) }]);
    const { calls, deps } = recording();
    const start = await runHook("session-start", recorded("session-start", root), deps);

    expect(calls).toEqual([]);
    expect(text(start)).toContain("The daemon is stopped until `squeal start`");
  });

  it("creates no store where neither a policy file nor a store exists", async () => {
    const root = checkout();

    expect((await stop(root, ["--until-start"])).stdout).toBe(noDaemonLine(root, true));
    expect(existsSync(storePaths(join(root, ".git") as AbsolutePath).database)).toBe(false);
  });
});

/** Every row of the store at `database`: its table, and its key in `meta`. */
function rowsOf(database: string): { table: string; key?: string }[] {
  const db = new DatabaseSync(database, { readOnly: true });
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
    return tables.flatMap(({ name }) => {
      const rows = db.prepare(`SELECT * FROM "${String(name)}"`).all();
      return rows.map((row) =>
        name === "meta" ? { table: "meta", key: String(row.key) } : { table: String(name) },
      );
    });
  } finally {
    db.close();
  }
}
