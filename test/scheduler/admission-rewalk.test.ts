import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { describe, expect, it } from "vitest";
import { rewalkMetaKey } from "../../src/core/scheduler/import-rewalk.js";
import type { SchedulerOptions } from "../../src/core/scheduler/options.js";
import { connectionOf } from "../../src/core/store/store.js";
import type { TestFileRef } from "../../src/core/types/keys.js";
import { SLOW } from "./cleanup.js";
import { createRepo, openRepoStore } from "./repo.js";
import { openHarness } from "./vitest-harness.js";

/*
 * Row 011-340 (the coordinator, request 8f07ef96, 2a): the import re-walk
 * reads its admission again inside its lock block, and a stop that begins
 * between its check before the lock and that block queues no chunk. Before
 * 011-340 the halt was read before the lock only: the chunk was queued as
 * runner work no stopped pump applies, and the scheduler never went idle.
 */

const FILES: Readonly<Record<string, string>> = {
  "src/leaf.ts": "export const value = 1;\n",
  "test/gate.test.ts": [
    'import { expect, it } from "vitest";',
    'import { value } from "../src/leaf.js";',
    'it("g", () => expect(value).toBe(1));',
    "",
  ].join("\n"),
};

describe("the re-walk's admission under the lock (011-340)", SLOW, () => {
  it("queues no chunk when a stop begins between its check and its lock block", async () => {
    // A first daemon stores closures and results; its walks go, as in a store from before them.
    const repo = createRepo("basic");
    for (const [path, text] of Object.entries(FILES)) writeFileSync(join(repo.main, path), text);
    const store = openRepoStore(repo.commonDir);
    const first = await openHarness(repo.main, store, repo.commonDir, {
      tierSize: 2,
      policy: { baseline: { onStart: "lookup-then-run-missing" } },
    });
    await first.scheduler.start();
    await first.scheduler.idle();
    await first.scheduler.close();
    connectionOf(store).run("DELETE FROM test_file_imports");

    const h = await openHarness(repo.main, store, repo.commonDir, { tierSize: 2 });
    const walked: string[] = [];
    const closure = h.runner.closure.bind(h.runner);
    h.runner.closure = (testFile: TestFileRef) => {
      walked.push(testFile.path);
      return closure(testFile);
    };
    // The daemon's stop flag (`SchedulerOptions.stopping`), which the harness does not pass.
    let stopping = false;
    const options: Pick<SchedulerOptions, "stopping"> = Reflect.get(h.scheduler, "options");
    Object.assign(options, { stopping: () => stopping });
    // The lock tells its holder before the task runs: the stop begins after the check before it.
    const blocks: string[] = [];
    h.scheduler.watchLock?.((holder) => {
      if (holder?.operation !== "queueing the import re-walk") return;
      blocks.push(holder.operation);
      stopping = true;
    });

    await h.scheduler.start();
    const idle = await Promise.race([
      h.scheduler.idle().then(() => true),
      delay(15_000).then(() => false),
    ]);
    expect(blocks).toHaveLength(1);
    expect(idle, "a chunk queued as runner work would keep it busy").toBe(true);
    expect(walked).toEqual([]);
    expect(store.meta.get(rewalkMetaKey(h.worktreeId))).toBeNull();
  });
});
