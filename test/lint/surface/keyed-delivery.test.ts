import { describe, expect, it } from "vitest";
import { formatDelta } from "../../../src/core/delivery/index.js";
import { FakeProvider } from "../pass/helpers.js";
import { deliveryOf, wiredRig } from "../wiring/rig.js";

/*
 * Review 0.1.360 B1 through the shared delivery: after a config keying, a
 * session's change from before it is not told as the file's finding, and
 * the main store's failed commit leaves the summary owed, told once.
 */

const CONFIG_A = "export default [{ rules: { 'no-undef': 'off' } }];\n";
const CONFIG_B = "export default [{ rules: { 'no-console': 'off' } }];\n";
const SUMMARY = "Lint config changed: 1 file with findings now; squeal lint lists them.";

/** The delivery's lint lines: summary, changes and reasons, no header. */
const lintLinesOf = (text: string) =>
  text.split("\n").filter((l) => /^(Lint|FAIL lint|PASS lint|RESOLVED lint)\b/.test(l));

/**
 * `a` passes under `CONFIG_A` at registration; the session's edit adds a
 * `no-console` finding at revision 2, not delivered; the config turns
 * `no-console` off and `no-undef` on at revision 3.
 */
async function acrossConfig() {
  const fake = new FakeProvider();
  fake.off.add("no-undef");
  const rig = await wiredRig(
    { "eslint.config.js": CONFIG_A, "src/a.js": "bad no-undef\n" },
    { provider: fake },
  );
  const delivery = deliveryOf(rig);
  const me = rig.consumer();
  expect((await delivery.register(me)).lint).toEqual({ v: 1, failing: 0, stale: 0 });
  await rig.edit({ "src/a.js": "bad no-undef\nbad no-console\n" });
  fake.off.clear();
  fake.off.add("no-console");
  await rig.edit({ "eslint.config.js": CONFIG_B });
  return { rig, delivery, me };
}

describe("lint news across a config keying in the shared delivery (review 0.1.360 B1)", () => {
  it("tells the summary, with no finding from before the keying", async () => {
    const { delivery, me } = await acrossConfig();
    const text = formatDelta((await delivery.onToolBoundary(me)) ?? expect.unreachable());
    expect(text.split("\n")[0]).toBe("SQUEAL · revision 3");
    expect(lintLinesOf(text)).toEqual([SUMMARY]);
    expect(text).not.toContain("no-console");
    expect(await delivery.onToolBoundary(me)).toBeNull();
  });

  it("tells the summary once more, and no old finding, when the delivery that read it fails before it commits", async () => {
    const { rig, delivery, me } = await acrossConfig();
    const touch = rig.store.consumers.touch;
    rig.store.consumers.touch = () => {
      throw new Error("SQLITE_BUSY");
    };
    await expect(delivery.onToolBoundary(me)).rejects.toThrow("SQLITE_BUSY");
    rig.store.consumers.touch = touch;
    const text = formatDelta((await delivery.onToolBoundary(me)) ?? expect.unreachable());
    expect(lintLinesOf(text)).toEqual([SUMMARY]);
    expect(text).not.toContain("no-console");
    expect(await delivery.onToolBoundary(me)).toBeNull();

    // A genuine edit after the keying is told against the view the summary seeded.
    await rig.edit({ "src/a.js": "bad no-undef\nbad no-alert\n" });
    const edit = formatDelta((await delivery.onToolBoundary(me)) ?? expect.unreachable());
    expect(lintLinesOf(edit)).toEqual([
      "FAIL lint: src/a.js: 2 findings, +1 no-alert (no-alert found)",
    ]);
  });
});
