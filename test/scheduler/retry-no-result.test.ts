import { randomUUID } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { askNoResultRun, readRetries } from "../../src/core/retry/index.js";
import type { CheckId } from "../../src/core/types/index.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";
import { loadKnob, options } from "./retry-fixture.js";

/*
 * Spec 011 C5 as amended (gh-36, row 011-16): `squeal retry` on a test file
 * with no result at its key queues one run of it at once, whatever its
 * reason and the load. `test/crash.test.ts` kills its worker while a marker
 * outside the worktree exists, so its run gives no result and the file
 * stays `unknown` at its key, as the issue's withheld run left it.
 */

const CRASH = "test/crash.test.ts";
const REF = { project: "", path: CRASH };
const holds: CheckId = { kind: "test", project: "", testPath: CRASH, fullName: "holds" };

const markers: string[] = [];
afterEach(() => {
  for (const marker of markers.splice(0)) rmSync(marker, { force: true });
});

describe("squeal retry on a file with no result", SLOW, () => {
  it("runs it once at once, at a load a load retry waits for, and ends the request", async () => {
    const repo = createRepo();
    const marker = join(tmpdir(), `squeal-011-16-${randomUUID()}`);
    markers.push(marker);
    writeFileSync(marker, "");
    const load = loadKnob();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir, options(load));
    await h.scheduler.start();
    await h.scheduler.idle();
    h.write(
      CRASH,
      [
        'import { existsSync } from "node:fs";',
        'import { expect, it } from "vitest";',
        "",
        'it("holds", () => {',
        `  if (existsSync(${JSON.stringify(marker)})) process.kill(process.pid, "SIGKILL");`,
        "  expect(1).toBe(1);",
        "});",
        "",
      ].join("\n"),
    );
    await h.batch(CRASH);
    await h.scheduler.idle();
    expect(h.runsOf(CRASH)).toHaveLength(1);
    expect(h.sink.stateOf(holds)?.outcome ?? "unknown").toBe("unknown");
    rmSync(marker);

    const key = h.keyOf(CRASH) as string;
    const asked = { testFile: REF, key, reason: "load" as const, at: Date.now() };
    const request = { ...asked, session: "s1", worktreeId: h.worktreeId };
    expect(askNoResultRun(store, request).kind).toBe("queued");
    await h.scheduler.requestRetries();
    // Queued, not run: another session's request joins it.
    expect(askNoResultRun(store, { ...request, session: "s2" }).kind).toBe("joined");
    await h.scheduler.idle();

    expect(h.runsOf(CRASH)).toHaveLength(2);
    expect(h.sink.stateOf(holds)).toMatchObject({ outcome: "pass", validity: "current" });
    expect(readRetries(store)).toMatchObject([
      { noResult: true, end: { outcome: "passed", worktreeId: h.worktreeId } },
    ]);
  });
});
