import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { formatDelta, formatRegistration } from "../../../src/core/delivery/index.js";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import type { Consumer, Delta, Registration } from "../../../src/core/types/index.js";
import { check, result } from "../../state/helpers.js";
import { NOW, revise, type Seeded, seed } from "../../status/slow-tier-seed.js";
import { deliveryOf, wiredRig } from "./rig.js";

/*
 * Spec 017 goal 1: with `lint.enabled` off, a session's registration and
 * deliveries are byte for byte what they are with no lint wiring at all,
 * status has no lint part, and nothing creates `lint.sqlite`; a store an
 * earlier on-period left is not read.
 */

/** A payload as its consumer's twin would get it: the consumer named the same. */
const asTwin = <T extends Registration | Delta>(p: T, twin: Consumer): T => ({
  ...p,
  consumer: twin,
});

/** One session with the hook's lint source and one with none, through a test regression. */
async function twins(s: Seeded) {
  const wired = deliveryOf(s);
  const bare = deliveryOf(s, { lint: false });
  const a = { worktreeId: s.repo.mainId, sessionId: "a", agentId: "main" };
  const b = { ...a, sessionId: "b" };
  const registered = [await wired.register(a), asTwin(await bare.register(b), a)];
  revise(s.store, s.repo, ["src/a.ts"]);
  const file = { project: "", path: "src/a.test.ts" };
  createStateSink(s.store, { now: () => NOW }).applyResults(
    s.repo.mainId,
    3,
    [result(check("adds", file), "fail", { key: "key-src/a.test.ts" })],
    { checkpointId: null },
  );
  const told = [await wired.onToolBoundary(a), await bare.onToolBoundary(b)];
  return { registered, told: told.map((d) => (d === null ? null : asTwin(d, a))) };
}

function status(cwd: string, args: string[] = []) {
  let out = "";
  main(["status", ...args], { stdout: (t) => (out += t), stderr: () => {}, cwd, now: () => NOW });
  return out;
}

describe("lint off (017 goal 1)", () => {
  it("registers and delivers exactly as with no lint wiring, and creates no lint store", async () => {
    const s = seed({});
    const { registered, told } = await twins(s);
    const [withLint, without] = registered;
    expect(withLint).toEqual(without);
    expect(formatRegistration(withLint ?? expect.unreachable(), undefined, "squeal", NOW)).toBe(
      formatRegistration(without ?? expect.unreachable(), undefined, "squeal", NOW),
    );
    const [delta, plain] = told;
    expect(delta).not.toBeNull();
    expect(JSON.stringify(delta)).toBe(JSON.stringify(plain));
    expect(formatDelta(delta ?? expect.unreachable())).toBe(
      formatDelta(plain ?? expect.unreachable()),
    );
    expect(existsSync(lintStorePath(s.repo.commonDir))).toBe(false);
  });

  it("reads nothing of a lint store an earlier on-period left", async () => {
    const rig = await wiredRig({ "src/a.js": "bad no-undef\n" });
    expect(existsSync(lintStorePath(rig.repo.commonDir))).toBe(true);
    writeFileSync(join(rig.repo.main, "squeal.config.json"), JSON.stringify({}));
    const { registered, told } = await twins(rig);
    expect(registered[0]).toEqual(registered[1]);
    expect(registered[0]).not.toHaveProperty("lint");
    expect(JSON.stringify(told[0])).toBe(JSON.stringify(told[1]));
    expect(status(rig.repo.main)).not.toMatch(/^Lint/m);
    expect(JSON.parse(status(rig.repo.main, ["--json"]))).not.toHaveProperty("lint");
  });
});
