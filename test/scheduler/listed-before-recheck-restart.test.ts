import { copyFileSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { storePaths } from "../../src/core/store/index.js";
import type { PendingPhase, Policy, TestFileRef } from "../../src/core/types/index.js";
import { RUN_MISSING } from "../helpers/baseline.js";
import { claimRepo, fileName, type Side, side } from "./claims-fixture.js";

/*
 * Review 0.1.329 B2 (row 011-227, 011 C4 "Explicit checkpoints" as amended
 * 2026-10-20): a start under `lookup-only` commits its first lookup before
 * the recheck. A start that dies during the recheck leaves that commit to
 * the next one, which hands over only what the rows leave queued or
 * running. So the first commit keeps the predecessor's queued and running
 * misses `queued`, and the second commit settles them.
 *
 * The predecessor ran F0 at adapter version 1 and left its row pending.
 * Another branch's closure list names `SHARED`, so the first lookup at
 * version 2 misses and the recheck asks for F0's own closure. Inside it the
 * test saves the store as a process death there leaves it (`VACUUM INTO`).
 * That start finishes as the control; then the image is restored and a new
 * start must hand F0 over, unless its second lookup hits.
 */

const F0 = fileName(0);
const REF: TestFileRef = { project: "", path: F0 };
const SHARED = "src/shared.ts";
const LOOKUP_ONLY: Pick<Policy, "baseline"> = { baseline: { onStart: "lookup-only" } };
/** Real schedulers, a real store and git: a loaded host needs headroom. */
const SLOW = { timeout: 90_000 } as const;

const ran = (s: Side) => s.runner.runs.flat().map((file) => file.path);

/** A scheduler of `root` whose runner keys at `adapterVersion`. */
function at(root: string, adapterVersion: string, policy: Pick<Policy, "baseline">): Side {
  const s = side(root, { count: 1, policy, rerunCap: 0 });
  const environment = s.runner.environment;
  s.runner.environment = async () =>
    (await environment()).map((env) => ({ ...env, adapterVersion }));
  return s;
}

async function idleAndClosed(s: Side): Promise<void> {
  await s.scheduler.start();
  await s.scheduler.idle();
  s.stopBeat();
  await s.scheduler.close();
}

/**
 * The control start and the start from its first commit's image, with the
 * predecessor's row `pending` and, with `hits`, a pass another worktree
 * stored at F0's own key, which the second lookup finds.
 */
async function restartedFromFirstCommit(pending: PendingPhase, hits: boolean) {
  const { main, others } = claimRepo(1, { [SHARED]: "export const shared = 1;\n" }, 2);
  const [other, third] = others as [string, string];
  const database = storePaths(realpathSync(join(main, ".git"))).database;
  const image = join(main, "..", "first-commit.sqlite");
  const p = at(other, "1", RUN_MISSING);
  await idleAndClosed(p);
  expect(ran(p)).toEqual([F0]);
  const c = at(third, "2", RUN_MISSING);
  if (hits) await idleAndClosed(c);

  // Another branch resolved F0 last; the predecessor left its row pending.
  const method = "static imports plus declared inputs" as const;
  const closure = { testFile: REF, paths: [SHARED, F0], complete: false, method };
  p.store.testFiles.put({ testFile: REF, closure, updatedAt: Date.now(), updatedBy: "branch" });
  const rows = p.store.testFileKeys.list(p.worktreeId);
  p.store.testFileKeys.upsertMany(rows.map((row) => ({ ...row, pending })));

  const b = at(other, "2", LOOKUP_ONLY);
  const atRecheck: (string | null | undefined)[] = [];
  b.runner.closure = async (testFile) => {
    atRecheck.push(b.phase(F0));
    if (atRecheck.length === 1) {
      const db = new DatabaseSync(database);
      db.exec(`VACUUM INTO '${image}'`);
      db.close();
    }
    return { testFile, paths: [testFile.path] };
  };
  await b.scheduler.start();
  await b.scheduler.idle();
  const control = { ran: ran(b), phase: b.phase(F0), passing: b.passing() };
  b.stopBeat();
  await b.scheduler.close();

  // The process died in the recheck: only the first commit's image is left.
  for (const s of [p, c, b]) s.store.close();
  copyFileSync(image, database);
  for (const suffix of ["-wal", "-shm"]) rmSync(`${database}${suffix}`, { force: true });
  const d = at(other, "2", LOOKUP_ONLY);
  await d.scheduler.start();
  await d.scheduler.idle();
  return { atRecheck, control, d };
}

describe(
  "a restart from the first lookup's commit hands the work over (review 0.1.329 B2)",
  SLOW,
  () => {
    it("a queued miss stays queued through the first commit and runs after the restart", async () => {
      const { atRecheck, control, d } = await restartedFromFirstCommit("queued", false);
      expect(atRecheck).toEqual(["queued"]);
      expect(control).toEqual({ ran: [F0], phase: null, passing: 1 });
      expect(ran(d)).toEqual([F0]);
      expect(d.phase(F0)).toBeNull();
      expect(d.passing()).toBe(1);
    });

    it("a running miss stays owed through the first commit and runs after the restart", async () => {
      const { atRecheck, control, d } = await restartedFromFirstCommit("running", false);
      expect(atRecheck).toEqual(["queued"]);
      expect(control).toEqual({ ran: [F0], phase: null, passing: 1 });
      expect(ran(d)).toEqual([F0]);
      expect(d.phase(F0)).toBeNull();
      expect(d.passing()).toBe(1);
    });

    it("a queued file whose second lookup hits never runs, and the second commit settles its row", async () => {
      const { atRecheck, control, d } = await restartedFromFirstCommit("queued", true);
      expect(atRecheck).toEqual(["queued"]);
      expect(control).toEqual({ ran: [], phase: null, passing: 1 });
      expect(ran(d)).toEqual([]);
      expect(d.phase(F0)).toBeNull();
      expect(d.passing()).toBe(1);
    });
  },
);
