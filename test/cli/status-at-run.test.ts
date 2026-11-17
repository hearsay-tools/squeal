import { describe, expect, it } from "vitest";
import type { AbsolutePath } from "../../src/core/types/common.js";
import { fixture, git, link, linkInstall, ref, write } from "../commit/at-keys-fixture.js";
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

  it("cuts a file off at the one budget and reports it not run (budget) with a rerun that fits", async () => {
    const f = fixture({ ...ON, "src/a.ts": "export const value = 1;\n", [TEST.path]: SLOW_TEST });
    const a = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/a.ts": "export const value = 2;\n" });
    const options = { cacheRoot: f.cacheRoot, install: linkInstall().install };

    const cut = await run(f, { commit: a, run: { allMissing: false, timeoutSeconds: 3 } }, options);
    expect(cut.code).toBe(3);
    expect(cut.out).toContain(`${TEST.path}: not run (budget) -> no result`);
    expect(cut.out).toContain(
      `1 not run (budget). A rerun that fits: squeal status --at ${a} --run --timeout 60`,
    );
    const json = await run(
      f,
      { commit: a, json: true, run: { allMissing: false, timeoutSeconds: 3 } },
      options,
    );
    expect(JSON.parse(json.out).run).toMatchObject({
      timeoutSeconds: 3,
      selected: 1,
      ran: 0,
      notRun: 1,
      timedOut: true,
    });
    const failed = await run(
      f,
      { commit: a, run: { allMissing: false, timeoutSeconds: 3 } },
      {
        cacheRoot: f.cacheRoot,
        install: async () => ({ ok: false, command: "npm ci", ms: 1, reason: "exit 1", log: "" }),
      },
    );
    expect(failed.code).toBe(3);
    expect(failed.out).toContain("The checkout gave no keys: install: npm ci: exit 1");
    expect(failed.out).not.toContain("--run:");
    // Nothing was stored for it.
    const after = await run(f, { commit: a, json: true }, options);
    expect(fileOf(after.out, TEST.path)?.at).toMatchObject({ state: "no result" });
    clean(f);
  });

  it("--all-missing prints the estimate first, runs every file with no result, and refuses one that needs an untracked path", async () => {
    const GEN = ref("test/gen.test.ts");
    const BAD = ref("test/bad.test.ts");
    const { f, a } = changed();
    f.commit({
      ".gitignore": "node_modules/\nsrc/gen.ts\n",
      [GEN.path]: testOf("gen", 1),
      [BAD.path]: testOf("plain", 2),
    });
    const b = git(f.root, "rev-parse", "HEAD").trim();
    f.commit({ "src/plain.ts": "export const value = 1; // c\n" });
    // The install writes a source git does not hold, which `gen.test.ts` loads (D4.9).
    const install = async (tree: AbsolutePath) => {
      link(tree);
      write(tree, { "src/gen.ts": "export const value = 1;\n" });
      return { ok: true, command: "link", ms: 0 } as const;
    };
    const options = { cacheRoot: f.cacheRoot, install };

    const all = await run(
      f,
      { commit: b, run: { allMissing: true, timeoutSeconds: 600 } },
      options,
    );
    const at = b.slice(0, 9);
    expect(all.err).toMatch(
      new RegExp(
        `squeal: --all-missing: 3 test files with no result at ${at} to run, up to \\d+ at once; no stored duration, so the time is unknown; the budget is 600 s, the checkout and install included\n`,
      ),
    );
    // The estimate comes before the gate's own lines.
    expect(all.err.indexOf("--all-missing")).toBeLessThan(all.err.lastIndexOf("squeal: "));
    expect(all.out).toContain(`${GEN.path}: not comparable (needs src/gen.ts) -> `);
    expect(all.out).toContain(
      `--run: 3 of 3 test files with no result at ${at} ran in its checkout and are stored at its keys`,
    );
    expect(all.out).toContain(`1 not run: their closure needs a path git does not hold at ${at}`);
    expect(all.out).toContain(
      `${BAD.path}: fail -> no result (at ${at}: value; run by this command)`,
    );
    const json = await run(f, { commit: b, json: true }, options);
    expect(fileOf(json.out, BAD.path)?.at).toMatchObject({ state: "fail", failed: ["value"] });
    expect(fileOf(json.out, TEST.path)?.at.state).toBe("pass");
    expect(fileOf(json.out, PLAIN.path)?.at.state).toBe("pass");
    expect(fileOf(json.out, GEN.path)?.at.state).toBe("no result");
    // `a` was keyed at a; nothing at `a` was asked.
    expect(a).not.toBe(b);
    clean(f);
  });
});

/** A test of `src/a.ts` that takes 30 s, longer than any budget here. */
const SLOW_TEST = [
  'import { expect, it } from "vitest";',
  'import { value } from "../src/a";',
  'it("slow", async () => {',
  "  await new Promise((done) => setTimeout(done, 30_000));",
  "  expect(value).toBeGreaterThan(0);",
  "}, 60_000);",
  "",
].join("\n");
