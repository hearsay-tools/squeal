import { describe, expect, it } from "vitest";
import { openedAtStart } from "../../src/core/daemon/daemon.js";
import type { RecoveringRunner } from "../../src/core/daemon/runner.js";
import { SOURCE_LAUNCH } from "../runner-host/process-helpers.js";

/*
 * Spec 021 D20.1 (row 021-26): a local runner host (the fast Vitest
 * instance, each node:test and pytest runner) starts on the first call that
 * needs it, not at daemon start. Runners in this process still open there.
 */

describe("the daemon's start (spec 021 D20.1)", () => {
  /** A runner whose `open` is counted in `opened`. */
  const counted = (name: string, opened: string[]) =>
    ({
      open: async () => {
        opened.push(name);
        return true;
      },
    }) as unknown as RecoveringRunner;

  it("opens no runner in a local runner host: each starts on its first call", async () => {
    const opened: string[] = [];
    const sets = [
      { members: () => [counted("node-test", opened)] },
      { members: () => [counted("pytest", opened)] },
    ];
    const host = { launch: SOURCE_LAUNCH, version: "0.0.0-test" };
    // A hosted Vitest is passed as `null`.
    await Promise.all(await openedAtStart(async () => false, null, host, sets));
    expect(opened).toEqual([]);
    await Promise.all(
      await openedAtStart(async () => false, counted("vitest", opened), undefined, sets),
    );
    expect(opened).toEqual(["vitest", "node-test", "pytest"]);
  });
});
