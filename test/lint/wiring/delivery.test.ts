import { describe, expect, it } from "vitest";
import { formatDelta, formatRegistration } from "../../../src/core/delivery/index.js";
import { createStateSink } from "../../../src/core/state/index.js";
import { check, result } from "../../state/helpers.js";
import { NOW } from "../../status/slow-tier-seed.js";
import { deliveryOf, wiredRig } from "./rig.js";

/*
 * Spec 017 D8 through the shared delivery: the registration's lint line,
 * each lint change told once after the test blocks, five in full and the
 * rest by number, with the real lint pass writing the store.
 */

const lines = (text: string) => text.split("\n");

describe("lint in a session's deliveries (017 D8)", () => {
  it("registers by count, tells a new finding once, then is silent", async () => {
    const rig = await wiredRig({ "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" });
    const delivery = deliveryOf(rig);
    const me = rig.consumer();
    const registration = await delivery.register(me);
    expect(registration.lint).toEqual({ v: 1, failing: 1, stale: 0 });
    expect(lines(formatRegistration(registration, undefined, "squeal", NOW))).toContain(
      "Lint: 1 file with findings; squeal lint lists them.",
    );

    await rig.edit({ "src/b.js": "bad no-console\n" });
    const delta = await delivery.onToolBoundary(me);
    const text = formatDelta(delta ?? expect.unreachable());
    expect(lines(text)[0]).toBe("SQUEAL · 1 lint change at revision 2");
    expect(lines(text)).toContain(
      "FAIL lint: src/b.js: 1 finding, +1 no-console (no-console found)",
    );
    expect(await delivery.onToolBoundary(me)).toBeNull();

    await rig.edit({ "src/b.js": "ok\n" });
    const fixed = formatDelta((await delivery.onToolBoundary(me)) ?? expect.unreachable());
    expect(lines(fixed)).toContain("PASS lint: src/b.js: no findings");
  });

  it("tells five lint changes in full and the rest by number", async () => {
    const names = ["a", "b", "c", "d", "e", "f", "g"].map((n) => `src/${n}.js`);
    const rig = await wiredRig(Object.fromEntries(names.map((p) => [p, "ok\n"])));
    const delivery = deliveryOf(rig);
    const me = rig.consumer();
    await delivery.register(me);
    await rig.edit(Object.fromEntries(names.map((p) => [p, "bad no-undef\n"])));
    const delta = (await delivery.onToolBoundary(me)) ?? expect.unreachable();
    expect(delta.lint?.entries).toHaveLength(5);
    const text = lines(formatDelta(delta));
    expect(text[0]).toBe("SQUEAL · 7 lint changes at revision 2");
    expect(text.filter((l) => l.startsWith("FAIL lint: "))).toHaveLength(5);
    expect(text).toContain("and 2 more lint changes; squeal lint --changed lists them.");
    expect(await delivery.onToolBoundary(me)).toBeNull();
  });

  it("lists a test failure before every lint line, and titles both", async () => {
    const rig = await wiredRig({ "src/a.js": "ok\n" });
    const delivery = deliveryOf(rig);
    const me = rig.consumer();
    await delivery.register(me);
    await rig.edit({ "src/a.js": "bad no-undef\n" });
    const file = { project: "", path: "src/a.test.ts" };
    createStateSink(rig.store, { now: () => NOW }).applyResults(
      rig.repo.mainId,
      2,
      [result(check("adds", file), "fail", { key: "key-src/a.test.ts" })],
      { checkpointId: null },
    );
    const text = lines(formatDelta((await delivery.onToolBoundary(me)) ?? expect.unreachable()));
    expect(text[0]).toMatch(/^SQUEAL · 1 check changed \(1 test\) at revision 2; 1 lint change$/);
    const test = text.findIndex((l) => l.startsWith("FAIL  src/a.test.ts > adds"));
    const lint = text.indexOf("FAIL lint: src/a.js: 1 finding, +1 no-undef (no-undef found)");
    expect(test).toBeGreaterThan(0);
    expect(lint).toBeGreaterThan(test);
  });
});
