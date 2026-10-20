import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { worktreeIdFor } from "../../src/core/fs/index.js";
import type { SchedulerContext } from "../../src/core/scheduler/context.js";
import { recordHeadMove } from "../../src/core/scheduler/head-move.js";
import type { Ledger } from "../../src/core/scheduler/ledger.js";
import { formatStatus, readStatus } from "../../src/core/status/index.js";
import type { StatusSnapshot, Store } from "../../src/core/types/index.js";
import { git, initRepo, writeFile } from "../hash/git-repo.js";
import { open, tempDir } from "../store/helpers.js";
import { fileCheck, state } from "./helpers.js";

/*
 * Task 011-05 (gh-9): edit, validate, then commit with no further file
 * change. Status names one `HEAD` and one dirty flag in its revision line,
 * its Worktree line and its JSON, at once (before a reconciliation pass sees
 * the commit), after the pass, and with no daemon validating.
 */

const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

let root: string;
let id: string;
let store: Store;

beforeEach(() => {
  root = tempDir("squeal-gh9-");
  initRepo(root, { "src/sum.js": "export const sum = 1;\n", "test/sum.test.js": "ok\n" });
  id = worktreeIdFor(root);
  store = open(join(root, ".git"));
  daemon(true);
});

const sha = () => git(root, ["rev-parse", "HEAD"]).trim();

function daemon(alive: boolean): void {
  store.worktrees.upsert({
    id,
    root,
    commonDir: join(root, ".git"),
    isMain: true,
    registeredAt: 1,
    daemon: {
      socketPath: "/run/squeal.sock",
      startedAt: 1,
      heartbeatAt: alive ? NOW - 1_000 : NOW - 600_000,
      heartbeatIntervalMs: 5_000,
      squealVersion: "0.0.0",
    },
  });
}

/** The edit the daemon validated: revision 1, recorded dirty at the commit before. */
function validatedEdit(): string {
  const head = sha();
  writeFile(root, "src/sum.js", "export const sum = 2;\n");
  writeFile(root, "test/sum.test.js", "ok again\n");
  store.revisions.append({
    worktreeId: id,
    createdAt: NOW - 5_000,
    head,
    dirty: true,
    trigger: "watch",
    changes: [{ path: "src/sum.js", oldHash: "h0", newHash: "h1" }],
  });
  store.knownStates.upsertMany([state(id, fileCheck("test/sum.test.js"))]);
  return head;
}

/** The idle reconciliation pass (spec 001 D2), which records the commit's `HEAD` move. */
async function pass(): Promise<void> {
  const context = {
    store,
    worktreeId: id,
    root,
    head: async () => ({
      head: sha(),
      dirty: git(root, ["status", "--porcelain"]).trim() !== "",
    }),
  } as unknown as SchedulerContext;
  const revision = store.revisions.latest(id);
  await recordHeadMove(context, { revision } as unknown as Ledger);
}

function read(): { status: StatusSnapshot; revisionLine: string; worktreeLine: string } {
  const result = readStatus(root, { now: () => NOW });
  if (!result.available) throw new Error(result.message);
  const lines = formatStatus(result, NOW, "squeal", { full: true }).split("\n");
  const find = (prefix: string) => lines.find((l) => l.startsWith(prefix)) ?? "";
  return { status: result, revisionLine: find("Revision: "), worktreeLine: find("Worktree: ") };
}

/** Every commit SHA the text names is the JSON `head`. */
function expectOneIdentity({ status, revisionLine, worktreeLine }: ReturnType<typeof read>) {
  const text = `${revisionLine}\n${worktreeLine.replace(status.worktreeRoot, "<root>")}`;
  const named = text.match(/\b[0-9a-f]{7,40}\b/g) ?? [];
  expect(named.length, text).toBe(2);
  for (const short of named) expect(status.head?.startsWith(short), short).toBe(true);
}

describe("committing validated edits with no further file change (011-05, gh-9)", () => {
  it("before the commit: the revision's HEAD, dirty at revision 1", () => {
    const head = validatedEdit();
    const seen = read();

    expectOneIdentity(seen);
    expect(seen.status).toMatchObject({ head, dirty: true, dirtyObservedAt: 1 });
    expect(seen.revisionLine).toBe(`Revision: 1 · ${head.slice(0, 8)} + 1, dirty`);
    expect(seen.worktreeLine).toBe(
      `Worktree: ${root} (HEAD ${head.slice(0, 7)}, dirty at revision 1)`,
    );
  });

  it("at once: the new HEAD, moved since revision 1, dirty not known until the next pass", () => {
    validatedEdit();
    git(root, ["commit", "-q", "-am", "validated"]);
    const seen = read();

    expectOneIdentity(seen);
    expect(seen.status).toMatchObject({
      head: sha(),
      dirty: null,
      dirtyObservedAt: null,
      headMovedSince: 1,
    });
    expect(seen.revisionLine).toBe(`Revision: 1 · ${sha().slice(0, 8)} + 0, dirty not known`);
    expect(seen.worktreeLine).toBe(
      `Worktree: ${root} (HEAD ${sha().slice(0, 7)}, moved since revision 1; dirty state not known until the next pass)`,
    );
  });

  it("after a pass: the new HEAD, clean at revision 1, in text and JSON alike", async () => {
    validatedEdit();
    git(root, ["commit", "-q", "-am", "validated"]);
    await pass();
    const seen = read();

    expectOneIdentity(seen);
    expect(seen.status).toMatchObject({
      revision: 1,
      commit: { head: sha(), sinceHead: 0, dirty: false },
      head: sha(),
      dirty: false,
      dirtyObservedAt: 1,
    });
    expect(seen.status.headMovedSince).toBeUndefined();
    expect(seen.revisionLine).toBe(`Revision: 1 · ${sha().slice(0, 8)} + 0`);
    expect(seen.worktreeLine).toBe(
      `Worktree: ${root} (HEAD ${sha().slice(0, 7)}, clean at revision 1)`,
    );
  });

  it("a partial commit after a pass stays dirty at revision 1", async () => {
    validatedEdit();
    git(root, ["commit", "-q", "-m", "partial", "src/sum.js"]);
    await pass();
    const seen = read();

    expectOneIdentity(seen);
    expect(seen.status).toMatchObject({ head: sha(), dirty: true, dirtyObservedAt: 1 });
    expect(seen.revisionLine).toBe(`Revision: 1 · ${sha().slice(0, 8)} + 0, dirty`);
  });

  it("without a daemon, at once and after a pass: the new HEAD, dirty not known", async () => {
    validatedEdit();
    git(root, ["commit", "-q", "-am", "validated"]);
    daemon(false);
    const before = read();
    expectOneIdentity(before);
    expect(before.status).toMatchObject({ head: sha(), dirty: null, headMovedSince: 1 });
    expect(before.revisionLine).toBe(`Revision: 1 · ${sha().slice(0, 8)} + 0, dirty not known`);
    expect(before.worktreeLine).toBe(
      `Worktree: ${root} (HEAD ${sha().slice(0, 7)}, moved since revision 1; dirty state not known: no daemon is validating)`,
    );

    await pass();
    const after = read();
    expectOneIdentity(after);
    expect(after.status).toMatchObject({ head: sha(), dirty: null, dirtyObservedAt: null });
    expect(after.status.headMovedSince).toBeUndefined();
    expect(after.revisionLine).toBe(`Revision: 1 · ${sha().slice(0, 8)} + 0, dirty not known`);
    expect(after.worktreeLine).toBe(
      `Worktree: ${root} (HEAD ${sha().slice(0, 7)}, dirty state not known: no daemon is validating)`,
    );
  });

  it("leaves result validity for identical bytes as it was", async () => {
    validatedEdit();
    const counts = read().status.counts;
    git(root, ["commit", "-q", "-am", "validated"]);
    expect(read().status.counts).toEqual(counts);
    await pass();
    expect(read().status.counts).toEqual({ current: 1, pending: 0, stale: 0, unknown: 0 });
  });
});
