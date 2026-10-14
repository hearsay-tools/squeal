import { createServer } from "node:net";
import { describe, expect, it } from "vitest";
import { formatDelta, MESSAGE_CAP_CHARS } from "../../src/core/delivery/index.js";
import { formatStatus, formatWhy, readStatus, readWhy } from "../../src/core/status/index.js";
import type { StatusResult } from "../../src/core/types/index.js";
import { reportOf } from "../status/why-seed.js";
import { createRepo, openHarness, openRepoStore, SLOW } from "./helpers.js";

/** A port nothing listens on: bound once, then released. */
async function closedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("no port");
  return address.port;
}

const SERVER = "test/server.test.ts";
const MISSING = "test/missing.test.ts";

function statusText(result: StatusResult): string {
  if (!result.available) throw new Error(result.message);
  return formatStatus(result, Date.now());
}

/**
 * Task 001-361 through the scheduler, the store and the readers: a stored
 * failure keeps its code and cause, and the delivery, `squeal status` and
 * `squeal why` show them; a hook that threw reads "setup failed".
 */
describe("a stored failure shows its code and cause (task 001-361)", SLOW, () => {
  it("shows ECONNREFUSED and setup failed for a beforeAll fetch, ERR_MODULE_NOT_FOUND for a missing import", async () => {
    const port = await closedPort();
    const repo = createRepo();
    const store = openRepoStore(repo.commonDir);
    const h = await openHarness(repo.main, store, repo.commonDir);
    await h.scheduler.start();
    await h.scheduler.idle();
    const { delivery, consumer } = await h.consumer();

    h.write(
      SERVER,
      'import { beforeAll, it } from "vitest";\n' +
        `beforeAll(async () => { await fetch("http://127.0.0.1:${port}/"); });\n` +
        'it("serves", () => {});\n',
    );
    h.write(
      MISSING,
      'import { it } from "vitest";\nimport { gone } from "./does-not-exist.js";\nit("uses", () => gone);\n',
    );
    await h.batch(SERVER, MISSING);
    await h.scheduler.idle();

    // Stored as Vitest reported them: the cause's code, the error's own code, the phase.
    const fileLevel = (path: string) =>
      store.results
        .byKey(h.keyOf(path) ?? "")
        .find((r) => r.check.kind === "file" && r.outcome === "fail")?.errors[0];
    expect(fileLevel(SERVER)).toMatchObject({
      message: "fetch failed",
      phase: "setup",
      causes: [{ code: "ECONNREFUSED" }],
    });
    expect(fileLevel(MISSING)).toMatchObject({ code: "ERR_MODULE_NOT_FOUND", phase: "load" });

    const refused = `setup failed: fetch failed; cause: connect ECONNREFUSED 127.0.0.1:${port}`;
    const delta = await delivery.onToolBoundary(consumer);
    if (delta === null) throw new Error("nothing delivered");
    const told = formatDelta(delta);
    expect(told).toContain(refused);
    expect(told).toContain("(ERR_MODULE_NOT_FOUND)");
    expect(told.length).toBeLessThanOrEqual(MESSAGE_CAP_CHARS);

    const status = statusText(readStatus(h.root));
    expect(status).toContain(refused);
    expect(status).toMatch(/Cannot find module .* \(ERR_MODULE_NOT_FOUND\)/);
    expect(status).not.toMatch(/setup failed: Cannot find module/);

    const why = formatWhy(reportOf(readWhy(h.root, SERVER, {})));
    expect(why).toContain(`Caused by: connect ECONNREFUSED 127.0.0.1:${port}`);
    expect(formatWhy(reportOf(readWhy(h.root, MISSING, {})))).toContain(
      "code: ERR_MODULE_NOT_FOUND",
    );
  });
});
