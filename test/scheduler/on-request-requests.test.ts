import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishedLaneRequests } from "../../src/core/scheduler/narrow-asks-row.js";
import { onRequestFiles } from "../../src/core/state/groups.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";
import { BROWSER, heldSide } from "./held-side-fixture.js";

/*
 * Row 011-426, review 0.1.650 B1: which held files are on request is read
 * from the requests the scheduler publishes, through the real scheduler. A
 * narrow ask for A and a whole-group request (`squeal run browser`) run
 * side by side: with both, queued B runs by itself and is not on request,
 * whichever came first. With the narrow ask alone, B waits for a request.
 */

const A = "test/browser/a.test.ts";
const B = "test/browser/b.test.ts";
const FILES: readonly CatchUpFile[] = [A, B].map((path) => ({
  path,
  ms: 10,
  imports: ["src/core.ts"],
}));
const POLICY = { ...DEFAULT_POLICY, checks: [BROWSER] };

/** The paths `onRequestFiles` reads on request now, sorted. */
const onRequest = (side: CatchUpSide) => {
  const id = side.worktreeId as WorktreeId;
  const keys = side.store.testFileKeys.list(id);
  const held = onRequestFiles(side.store, id, keys, POLICY);
  return keys
    .filter((row) => held.has(testFileId(row.testFile)))
    .map((row) => row.testFile.path)
    .sort();
};
/** The groups the scheduler publishes an open whole-group request for. */
const requested = (side: CatchUpSide) =>
  publishedLaneRequests(side.store, side.worktreeId as WorktreeId, 0 as EpochMs).requested;
const ran = (side: CatchUpSide) => side.runner.runs.flatMap((r) => r.files.map((f) => f.path));

/** Both files pending after an edit of what they import; every run held by the gate. */
async function edited() {
  const { side, gate } = await heldSide(FILES);
  await side.edit("watch", "src/core.ts");
  await side.rest();
  expect(onRequest(side)).toEqual([A, B]);
  return { side, gate };
}

const POLL = { timeout: 20_000 };

describe("on-request files follow the scheduler's published requests (review 0.1.650 B1)", {
  timeout: 60_000,
}, () => {
  it("a narrow ask for A alone leaves B on request, and B never runs", async () => {
    const { side, gate } = await edited();
    await side.scheduler.requestGroupPaths?.("browser", [A]);
    await expect.poll(() => side.runner.runs.length, POLL).toBe(1);
    await side.rest();
    expect(onRequest(side)).toEqual([B]);
    gate.stop();
    await side.rest();
    expect(ran(side)).toEqual([A]);
    expect(onRequest(side)).toEqual([B]);
  });

  it("a whole-group request leaves no file on request, and both run", async () => {
    const { side, gate } = await edited();
    await side.scheduler.requestGroup("browser");
    await expect.poll(() => side.runner.runs.length, POLL).toBe(1);
    await side.rest();
    expect(onRequest(side)).toEqual([]);
    expect([...requested(side)]).toEqual(["browser"]);
    gate.stop();
    await expect.poll(() => ran(side).sort(), POLL).toEqual([A, B]);
    // The request ends once the lane has nothing queued: the row says so.
    await expect.poll(() => [...requested(side)], POLL).toEqual([]);
    expect(onRequest(side)).toEqual([]);
  });

  it("a narrow ask for A, then a whole-group request: B is queued, and runs with no other request", async () => {
    const { side, gate } = await edited();
    await side.scheduler.requestGroupPaths?.("browser", [A]);
    await expect.poll(() => side.runner.runs.length, POLL).toBe(1);
    await side.scheduler.requestGroup("browser");
    await side.rest();
    expect(onRequest(side)).toEqual([]);
    gate.stop();
    await expect.poll(() => ran(side).sort(), POLL).toEqual([A, B]);
  });

  it("a whole-group request, then a narrow ask for A: B is queued, and runs", async () => {
    const { side, gate } = await edited();
    await side.scheduler.requestGroup("browser");
    await expect.poll(() => side.runner.runs.length, POLL).toBe(1);
    await side.scheduler.requestGroupPaths?.("browser", [A]);
    await side.rest();
    expect(onRequest(side)).toEqual([]);
    gate.stop();
    await expect.poll(() => ran(side).sort(), POLL).toEqual([A, B]);
  });
});
