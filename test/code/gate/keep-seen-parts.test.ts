import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { keepSeen, type Seen } from "../../../src/core/code/gate/keep-seen.js";
import { partsOf, writeThroughDaemon } from "../../../src/core/code/gate/keep-sent.js";
import { StoreWait } from "../../../src/core/code/gate/keep-wait.js";
import { InputCheck } from "../../../src/core/code/gate/keep-write.js";
import type {
  AbsolutePath,
  EpochMs,
  RelativePath,
  WorktreeId,
} from "../../../src/core/types/common.js";
import type { TestFileRef } from "../../../src/core/types/keys.js";

/*
 * Review 0.1.508 B2 (rows 020-67, 020-48): a serving daemon writes the
 * runs' reads in parts of at most 4 MiB. Each part that lands is a landed
 * write, so it restarts the keeper's 30 s quiet bound before the next part
 * is tried. The real `writeThroughDaemon`, `keepSeen` and `StoreWait` run
 * against a socket that answers as a daemon, with a fake clock.
 */

const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const clean of cleanups.splice(0)) clean();
});

/** One file's reads, long enough to make two parts. */
function twoParts(): Seen[] {
  const ref = { project: "", path: "test/a.test.ts" } as TestFileRef;
  const add = Array.from(
    { length: 45_000 },
    (_, i) => `src/${i}-${"a".repeat(90)}.ts` as RelativePath,
  );
  return [{ ref, add, direct: [], modules: [] }];
}

/**
 * A socket that answers each `keep` request with the next of `answers`:
 * kept or busy, at the time it sets on the clock.
 */
async function daemonAt(
  answers: readonly { readonly kept: boolean; readonly at: number }[],
  clock: { now: number },
): Promise<{ readonly socket: AbsolutePath; readonly asked: () => number }> {
  const dir = mkdtempSync(join(tmpdir(), "keep-seen-parts-"));
  const socket = join(dir, "d.sock") as AbsolutePath;
  let asked = 0;
  const server: Server = createServer((connection) => {
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      const request = JSON.parse(buffer.slice(0, end)) as { type: string; id: string };
      const answer = answers[asked] ?? { kept: true, at: clock.now };
      asked += 1;
      clock.now = answer.at;
      const response = {
        schemaVersion: 1,
        ok: true,
        type: "keep",
        requestId: request.id,
        outcome: { kept: answer.kept },
      };
      connection.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise<void>((done) => server.listen(socket, done));
  cleanups.push(() => {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return { socket, asked: () => asked };
}

describe("review 0.1.508 B2: each reads part that lands restarts the quiet bound", () => {
  it("goes on waiting when a part landed at 29 s and the next is busy at 31 s", async () => {
    const seen = twoParts();
    expect(partsOf(seen)).toHaveLength(2);
    const clock = { now: 0 };
    // Try 1: part 1 busy at 0 s, which starts the wait. Try 2: part 1 kept at 29 s, part 2
    // busy at 31 s. Try 3: both parts kept.
    const daemon = await daemonAt(
      [
        { kept: false, at: 0 },
        { kept: true, at: 29_000 },
        { kept: false, at: 31_000 },
        { kept: true, at: 31_000 },
        { kept: true, at: 31_000 },
      ],
      clock,
    );
    const writer = writeThroughDaemon({
      socketPath: daemon.socket,
      worktreeId: "w" as WorktreeId,
      storeSchema: 1,
    });
    const wait = new StoreWait({
      now: () => clock.now as EpochMs,
      boundMs: 30_000,
      tell: () => {},
      runMs: () => 60_000,
    });
    const database = "/nonexistent/keep-seen-parts/store.sqlite" as AbsolutePath;

    const merged = await keepSeen(writer, seen, {
      database,
      giveUp: (db) => wait.giveUp(db, []),
      landed: () => wait.landed(),
      check: new InputCheck(),
    });

    expect(merged).toBe("kept");
    expect(wait.stop).toBeNull();
    expect(daemon.asked()).toBe(5);
  });

  it("still stops when no part landed for 30 s", async () => {
    const seen = twoParts();
    const clock = { now: 0 };
    const daemon = await daemonAt(
      [
        { kept: false, at: 0 },
        { kept: false, at: 10_000 },
        { kept: false, at: 20_000 },
        { kept: false, at: 30_000 },
      ],
      clock,
    );
    const writer = writeThroughDaemon({
      socketPath: daemon.socket,
      worktreeId: "w" as WorktreeId,
      storeSchema: 1,
    });
    const wait = new StoreWait({
      now: () => clock.now as EpochMs,
      boundMs: 30_000,
      tell: () => {},
      runMs: () => 60_000,
    });

    const merged = await keepSeen(writer, seen, {
      database: "/nonexistent/keep-seen-parts/store.sqlite" as AbsolutePath,
      giveUp: (db) => wait.giveUp(db, []),
      landed: () => wait.landed(),
      check: new InputCheck(),
    });

    expect(merged).toBe("spent");
    expect(wait.stop).toBe("quiet");
    expect(clock.now).toBe(30_000);
  });
});
