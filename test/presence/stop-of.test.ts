import { describe, expect, it } from "vitest";
import { headerLines } from "../../src/core/delivery/header.js";
import { formatStatus } from "../../src/core/status/index.js";
import type { DaemonLiveness, EpochMs } from "../../src/core/types/index.js";
import { settled } from "../evals/status-snapshot.js";

/*
 * Review 0.1.357 B1, moved from `test/cli/until-start-readers.test.ts` by row
 * 011-293: `stopOf`, the one rule the renderers read, says a stop only with
 * `stopped` and never while a start is current.
 */

const at = (ms: number) => ms as EpochMs;

describe("`stopOf`, the one rule the renderers read (review 0.1.357 B1)", () => {
  const down = { state: "down", since: at(1_000) } as const;
  const lines = (daemon: DaemonLiveness) => {
    const snapshot = { ...settled, daemon };
    const header = { ...snapshot, daemon };
    return [
      formatStatus(snapshot, at(20_000), "squeal", { full: true }),
      headerLines(header as never, "squeal").join("\n"),
    ].join("\n");
  };

  it("reads `untilStart` only with `stopped`", () => {
    const text = lines({ ...down, untilStart: true });
    expect(text).not.toContain("stopped until");
    expect(text).toContain("No daemon has validated since");
  });

  it("names no stop while a start is current", () => {
    const text = lines({ ...down, stopped: true, untilStart: true, startingSince: at(19_000) });
    expect(text).not.toContain("stopped");
    expect(text).toContain("A daemon is starting");
  });
});
