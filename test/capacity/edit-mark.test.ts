import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { TreeCpu } from "../../src/core/capacity/cores.js";
import { createPermitPool, type PermitPool, readMarks } from "../../src/core/capacity/index.js";

/*
 * Review 0.1.255, B1 and B2: the mark an edit's tier writes (011 C10 as
 * amended 2026-10-21, row 011-98). B1: a waiter whose edit runs keeps its
 * refused demand in the mark (task 011-96 notes, decision 6), and forgets it
 * with its age 30 s after its last look, at the edit's next refresh. B2: an
 * edit before any acquisition prepares the pool's directory as `acquire`
 * does, so its first mark is written. Each pool here is one simulated
 * daemon on two slots. A mark's age is its file's real mtime, so only the
 * waiter's clock moves on; the daemons that read its mark keep the real one.
 */

let root: string;
let dir: string;
const pools: PermitPool[] = [];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "squeal-edit-mark-test-"));
  // Not created: the first pool user prepares it.
  dir = join(root, "squeal-uid");
});

afterEach(() => {
  for (const pool of pools.splice(0)) pool.close();
  rmSync(root, { recursive: true, force: true });
});

/** A tree whose next read gives `cores`; `null`, unmeasured, until the test sets it. */
function fakeTree(): TreeCpu & { cores: number | null } {
  return {
    cores: null,
    read() {
      return this.cores;
    },
    reset() {},
  };
}

function daemon(
  id: string,
  options: { readonly now?: () => number; readonly tree?: TreeCpu } = {},
): PermitPool {
  const pool = createPermitPool({
    dir,
    owner: { pid: process.pid, worktreeId: id },
    hostSlots: 2,
    cores: options.tree ?? fakeTree(),
    refreshMs: 20,
    ...(options.now === undefined ? {} : { now: options.now }),
  });
  pools.push(pool);
  return pool;
}

const markOf = (id: string) => readMarks(dir, "reader", Date.now()).find((m) => m.id === id);

/**
 * The reviewer's B1 probe: `holder` takes both permits, `waiter` is refused a
 * tier of at least 2 and starts an edit one worker wide. Returns the
 * waiter's clock and tree, and when it started to wait.
 */
function waiterInEdit() {
  const holder = daemon("holder").acquire(2);
  holder?.shrinkTo(2);
  expect(holder?.grant).toBe(2);
  const clock = { now: Date.now() };
  const tree = fakeTree();
  const waiter = daemon("waiter", { now: () => clock.now, tree });
  expect(waiter.acquire(2, "fast", 2)).toBeNull();
  const since = clock.now;
  waiter.running(1);
  expect(markOf("waiter")).toMatchObject({ want: 2, grant: 0, since, least: 2, cores: 1 });
  return { holder, clock, tree, since };
}

describe("a waiter's mark while its edit runs (review 0.1.255, B1)", () => {
  test("a refresh 30 s after its last look forgets its age and demand, so a newcomer takes a free permit", async () => {
    const { holder, clock, tree } = waiterInEdit();
    clock.now += 31_000;
    tree.cores = 0.5;
    await expect.poll(() => markOf("waiter")?.cores).toBe(0.5);
    // The edit's CPU stays; the waiter's age, demand and least go.
    const mark = markOf("waiter");
    expect(mark).toMatchObject({ want: 0, grant: 0, since: null, cores: 0.5 });
    expect(mark?.least).toBeUndefined();
    holder?.release();
    expect(daemon("newcomer").acquire(1)?.grant).toBe(1);
  });

  test("inside 30 s the waiter keeps its seniority: a newcomer leaves the free permits to it", async () => {
    const { holder, clock, tree, since } = waiterInEdit();
    clock.now += 29_000;
    tree.cores = 0.5;
    await expect.poll(() => markOf("waiter")?.cores).toBe(0.5);
    expect(markOf("waiter")).toMatchObject({ want: 2, grant: 0, since, least: 2 });
    holder?.release();
    expect(daemon("newcomer").acquire(1)).toBeNull();
  });
});

describe("an edit before any acquisition (review 0.1.255, B2)", () => {
  test("prepares the missing pool directory and writes its mark; the next daemon's grant is gated", () => {
    const end = daemon("edit").running(4);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    // Unmeasured, its four workers count four cores: over the two slots.
    expect(markOf("edit")).toMatchObject({ want: 0, grant: 0, since: null, cores: 4 });
    expect(daemon("backlog").acquire(2)?.grant).toBe(1);
    end();
    expect(markOf("edit")).toBeUndefined();
  });

  test("a directory acquire refuses costs the edit nothing and gets no mark", () => {
    mkdirSync(dir, { mode: 0o700 });
    chmodSync(dir, 0o755);
    const edit = daemon("edit");
    expect(() => edit.acquire(1)).toThrow(/mode 755/);
    let end = (): void => {};
    expect(() => {
      end = edit.running(2);
    }).not.toThrow();
    expect(markOf("edit")).toBeUndefined();
    expect(() => end()).not.toThrow();
  });
});
