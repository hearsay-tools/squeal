import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { crashRekey } from "./crash-rekey-fixture.js";
import { cleanUp, createRepo, SLOW, traceRepo } from "./helpers.js";

/*
 * Row 011-289 (`research/ci-crash-rekey-stall.md`): a worker that dies while
 * the run's cancel waits for it leaves Vitest 5.0.3's cancel pending, and the
 * instance's next run waits for it before it starts a worker. The adapter
 * closes that instance; the file's run under its new key gets a new one.
 */
describe("scheduler: a worker that dies during its run's cancel (row 011-289)", SLOW, () => {
  it("runs the file again under its new key on a new instance, with bounded idle and cleanup", async () => {
    const repo = createRepo();
    const trace = traceRepo(repo);
    const [crashed, again] = await crashRekey(repo, trace, { held: true });

    // The cancel began before the worker died: the crash names both.
    expect(crashed?.report.failure).toContain(
      "run cancelled: the revisions during it changed an input of every file that had not ended",
    );
    expect(crashed?.report.failure).toContain("Worker forks emitted error");
    expect(crashed?.report).toMatchObject({ completedFiles: [], results: [] });
    const log = readFileSync(join(crashed?.options.logDir ?? "", "vitest.log"), "utf8");
    expect(log).toContain("the instance is closed; the next run starts a new one");
    expect(again?.report).toMatchObject({ end: "completed", failure: null });
    // Every cleanup step ends within the trace's bound, or this throws its `StallError`.
    await cleanUp();
  });
});
