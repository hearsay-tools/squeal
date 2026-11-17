import { describe, expect, it } from "vitest";
import { fixture, git, linkInstall, ref } from "../commit/at-keys-fixture.js";
import { SLOW } from "../scheduler/cleanup.js";
import { clean, run, testOf } from "./status-at-kit.js";

/*
 * Row 023-07, done-when; spec 023 D4: `squeal status --at <commit> --run`
 * on `$TMPDIR` git fixtures with the real Vitest adapter. Coverage is on,
 * as by default, so the gate keeps what it runs in the shared stores
 * (020 D17.3) at the keys the keying gives at the commit.
 */

const TEST = ref("test/a.test.ts");
const PLAIN = ref("test/plain.test.ts");
const ON = { "squeal.config.json": "{}\n" };

/** Commit A: `a.test.ts` and `plain.test.ts` pass; HEAD changes `src/a.ts` and its test. */
function changed() {
  const f = fixture({
    ...ON,
    "src/a.ts": "export const value = 1;\n",
    [TEST.path]: testOf("a", 1),
    "src/plain.ts": "export const value = 1;\n",
    [PLAIN.path]: testOf("plain", 1),
  });
  const a = git(f.root, "rev-parse", "HEAD").trim();
  f.commit({ "src/a.ts": "export const value = 2;\n", [TEST.path]: testOf("a", 2) });
  return { f, a };
}

const fileOf = (out: string, path: string) =>
  (
    JSON.parse(out).files as { path: string; at: { state: string; origin?: { kind: string } } }[]
  ).find((file) => file.path === path);

describe("squeal status --at --run (row 023-07, D4)", SLOW, () => {
  it("runs the file the diff selects once, stores it, and the next --at reads it with no run", async () => {
    const { f, a } = changed();
    const install = linkInstall();
    const options = { cacheRoot: f.cacheRoot, install: install.install };

    const first = await run(
      f,
      { commit: a, json: true, run: { allMissing: false, timeoutSeconds: 600 } },
      options,
    );
    const value = JSON.parse(first.out);
    expect(fileOf(first.out, TEST.path)?.at).toMatchObject({
      state: "pass",
      origin: { kind: "run" },
    });
    // Not selected: the diff A..HEAD touches nothing it loads.
    expect(fileOf(first.out, PLAIN.path)?.at).toMatchObject({ state: "no result" });
    expect(value.run).toMatchObject({
      timeoutSeconds: 600,
      selected: 1,
      ran: 1,
      notRun: 0,
      rerun: null,
    });
    expect(value.run.usedMs).toBeGreaterThanOrEqual(value.run.gateMs);
    // One checkout, one install: the run took the keying's checkout.
    expect(install.calls()).toBe(1);
    clean(f);

    const second = await run(f, { commit: a, json: true }, options);
    expect(fileOf(second.out, TEST.path)?.at).toMatchObject({ state: "pass" });
    expect(fileOf(second.out, TEST.path)?.at.origin?.kind).not.toBe("run");
    expect(JSON.parse(second.out).run).toBeNull();

    const third = await run(
      f,
      { commit: a, run: { allMissing: false, timeoutSeconds: 600 } },
      options,
    );
    expect(third.out).toContain(`--run: no file with no result at ${a.slice(0, 9)} to run`);
    clean(f);
  });
});
