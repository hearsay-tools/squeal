import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { headerLines } from "../../src/core/delivery/index.js";
import { readHeader } from "../../src/core/state/index.js";
import { CODEX } from "../harness/primer-helpers.js";
import { SLOW_A, SLOW_POLICY, seed, slowLine, states, status } from "./slow-tier-seed.js";

/*
 * Row 019-24 item 1 (spec 019 D4 step 3; 019-23 notes, "Found, not fixed"):
 * the `Slow tier:` line says how many times Stop may hold the agent in one
 * turn. At the default `stop.maxHolds` 1 it says "once", as before; above 1
 * it says "up to N times in a turn". The line is the same in each harness
 * but for the CLI it names.
 */

let runtime: string;
beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "squeal-slow-holds-"));
  vi.stubEnv("XDG_RUNTIME_DIR", runtime);
});
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(runtime, { recursive: true, force: true });
});

function required(maxHolds?: number) {
  const s = seed({
    ...SLOW_POLICY,
    stop: {
      requireSlowSuite: true,
      slowWaitMs: 90_000,
      ...(maxHolds === undefined ? {} : { maxHolds }),
    },
  });
  states(s.store, s.repo, [{ validity: "stale", observedAt: 1 }], [SLOW_A]);
  return s;
}

describe("the Slow tier line says Stop's holds per turn (019-24 item 1)", () => {
  it.each([undefined, 1])("says once at stop.maxHolds %s", (maxHolds) => {
    const s = required(maxHolds);
    expect(readHeader(s.store, s.repo.mainId).slowTier).not.toHaveProperty("maxHolds");
    expect(slowLine(status(s))).toBe(
      "Slow tier: 2 test files; 2 not run at revision 2. Stop waits up to 1 min 30 s for them or holds the agent once; `squeal run --slow --wait 60000` waits for their results.",
    );
  });

  it("says up to N times in a turn above 1, in status and both header forms", () => {
    const s = required(3);
    const header = readHeader(s.store, s.repo.mainId);
    expect(header.slowTier?.maxHolds).toBe(3);
    const line =
      "Slow tier: 2 test files; 2 not run at revision 2. Stop waits up to 1 min 30 s for them or holds the agent up to 3 times in a turn; `squeal run --slow --wait 60000` waits for their results.";
    expect(headerLines(header, "squeal")).toContain(line);
    expect(headerLines(header, "squeal", "news", { slowTierChanged: true })).toContain(line);
    // Codex names the CLI by its path; the holds read the same.
    expect(headerLines(header, CODEX)).toContain(
      line.replace("`squeal run", `\`${CODEX} run`),
    );
    expect(slowLine(status(s))).toBe(line);
  });

  it("says no holds while Stop does not wait for slow files", () => {
    const s = seed({ ...SLOW_POLICY, stop: { maxHolds: 3 } });
    expect(readHeader(s.store, s.repo.mainId).slowTier).not.toHaveProperty("maxHolds");
    expect(slowLine(status(s))).not.toContain("holds");
  });
});
