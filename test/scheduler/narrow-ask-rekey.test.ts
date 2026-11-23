import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { testFileId } from "../../src/core/keys/reverse-index.js";
import { publishedNarrowAsks } from "../../src/core/scheduler/narrow-asks-row.js";
import { formatStatus } from "../../src/core/status/format-status.js";
import { createStatusBuilder } from "../../src/core/status/snapshot.js";
import type { EpochMs, WorktreeId } from "../../src/core/types/common.js";
import type { CatchUpFile, CatchUpSide } from "./catch-up-fixture.js";
import { BROWSER, heldSide } from "./held-side-fixture.js";

/*
 * Rows 023-72 and 023-74 (dogfood round 9 Y2; the coordinator agreed the
 * scheduler edit). A narrow request (`squeal run <group> <path>...`, and
 * the working tree's side of `status --at --run`) releases a held group's
 * file by an ask at the file's key. Before, an ask whose pending file was
 * re-keyed before it ran was dropped, so the file stayed held: never run,
 * and status said it waits for `squeal run browser`. In round 9 the commit
 * daemon's run of a browser file grew the shared observed reads, the
 * worktree's daemon re-keyed that file (`regrowObserved`), and its ask left:
 * the files the commit side ran first were the ones the working tree never
 * ran. An edit after the call re-keys the same way; this test uses one.
 * Now a narrow ask follows its file to its new key while it stays pending.
 */

const FILES: readonly CatchUpFile[] = ["a", "b"].map((name) => ({
  path: `test/browser/${name}.test.ts`,
  ms: 10,
  imports: [`src/${name}.ts`],
}));
const [A, B] = FILES.map((file) => file.path) as [string, string];
const id = (path: string) => testFileId({ project: "", path });

const asks = (side: CatchUpSide) =>
  publishedNarrowAsks(side.store, side.worktreeId as WorktreeId, 0 as EpochMs);
const keyOf = (side: CatchUpSide, path: string) =>
  side.store.testFileKeys
    .list(side.worktreeId as WorktreeId)
    .find((row) => row.testFile.path === path)?.key;

async function plain(side: CatchUpSide): Promise<string> {
  const result = await createStatusBuilder(side.store).build(side.worktreeId as WorktreeId);
  return formatStatus(result, Date.now() as EpochMs);
}

describe("a requested held file re-keyed before it runs still runs (rows 023-72, 023-74)", {
  timeout: 60_000,
}, () => {
  it("moves the narrow ask to the file's new key, keeps it queued by the request, and runs it", async () => {
    const { side, gate } = await heldSide(FILES);
    writeFileSync(join(side.root, "squeal.config.json"), JSON.stringify({ checks: [BROWSER] }));
    await side.edit("watch", "src/a.ts", "src/b.ts");
    await side.rest();
    await side.scheduler.requestGroupPaths?.("browser", [A, B], { at: true });
    await expect.poll(() => side.runner.runs.length, { timeout: 20_000 }).toBe(1);
    const first = side.runner.runs[0]?.files[0]?.path === A ? A : B;
    const second = first === A ? B : A;
    const before = keyOf(side, second);

    // The queued file re-keys before it runs (round 9: the other side's run grew its reads).
    await side.edit("watch", second === A ? "src/a.ts" : "src/b.ts");
    await side.rest();
    const after = keyOf(side, second);
    expect(after).not.toBe(before);
    await expect.poll(() => asks(side).get(id(second)), { timeout: 20_000 }).toBe(after);
    // 023-74: the group reads as asked for, not as waiting for `squeal run browser`.
    const line = (await plain(side)).split("\n").find((text) => text.startsWith("browser: "));
    expect(line).toContain("Squeal runs them now");
    expect(line).not.toContain("only on request");
    expect(line).not.toContain("waiting for `squeal run browser`");

    // Every held run goes: the first ends, then the re-keyed one runs at its new key.
    gate.stop();
    await expect
      .poll(() => side.runner.runs.flatMap((run) => run.files.map((f) => f.path)), {
        timeout: 20_000,
      })
      .toEqual([first, second]);
    await expect
      .poll(() => side.store.meta.get(`narrow-asks:${side.worktreeId}`), { timeout: 20_000 })
      .toBeNull();
  });
});
