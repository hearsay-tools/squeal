import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { main } from "../../../src/cli/main.js";
import { lintStorePath } from "../../../src/core/lint/store/index.js";
import { seed } from "../../status/slow-tier-seed.js";
import { deliveryOf, runLint as run, wiredRig } from "../wiring/rig.js";

/*
 * Spec 017 D8: `squeal lint [<path>...] [--changed] [--json]`, read from the
 * lint store the real pass wrote, with no daemon running.
 */

const FILES = {
  "src/a.js": "bad no-undef\nbad no-console\n",
  "src/b.js": "ok\n",
  "src/c.js": "bad no-undef\n",
};

describe("squeal lint (017 D8)", () => {
  it("lists every file with findings, newest first, with no daemon", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    await rig.edit({ "src/c.js": "bad eqeqeq\n" });
    const { code, out } = await run(rig.repo.main, []);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "Lint: 2 files with findings",
        "  src/c.js: 1 finding, linted at revision 2",
        "    1:1  error    eqeqeq  eqeqeq found",
        "  src/a.js: 2 findings, linted at revision 1",
        "    1:1  error    no-undef  no-undef found",
        "    2:1  error    no-console  no-console found",
        "",
      ].join("\n"),
    );
  });

  it("with paths, shows those files, a passing one and one ESLint does not lint", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    const { code, out } = await run(rig.repo.main, ["src/b.js", "src/c.js", "README.md"]);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "Lint: 1 file with findings in src/b.js, src/c.js, README.md",
        "  src/b.js: no findings, linted at revision 1",
        "  src/c.js: 1 finding, linted at revision 1",
        "    1:1  error    no-undef  no-undef found",
        "Not linted (ESLint's config or the lint policy leaves them out):",
        "  README.md",
        "",
      ].join("\n"),
    );
    const json = JSON.parse((await run(rig.repo.main, ["src/b.js", "--json"])).out);
    expect(json).toMatchObject({
      v: 1,
      available: true,
      paths: ["src/b.js"],
      files: [{ path: "src/b.js", outcome: "pass", stale: false, findings: [], revision: 1 }],
      notLinted: [],
    });
  });

  it("with --changed, lists the files whose state changed since this session registered", async () => {
    const rig = await wiredRig(FILES, { alive: false });
    await deliveryOf(rig).register(rig.consumer("s1"));
    await rig.edit({ "src/b.js": "bad no-undef\n", "src/c.js": "ok\n" });
    const session = { CLAUDE_CODE_SESSION_ID: "s1" };
    const { code, out } = await run(rig.repo.main, ["--changed"], session);
    expect(code).toBe(0);
    expect(out).toBe(
      [
        "Lint: 2 files changed since this session started",
        "  FAIL lint: src/b.js: 1 finding, +1 no-undef (no-undef found); at revision 2; now fail: 1 finding, linted at revision 2",
        "  PASS lint: src/c.js: no findings; at revision 2; now pass: no findings, linted at revision 2",
        "",
      ].join("\n"),
    );
    const json = JSON.parse((await run(rig.repo.main, ["--changed", "--json"], session)).out);
    expect(json).toMatchObject({ v: 1, available: true, since: "session" });
    expect(json.entries.map((e: { path: string }) => e.path)).toEqual(["src/b.js", "src/c.js"]);
  });

  it("says lint is off, creates no lint store, and exits 1", async () => {
    const s = seed({});
    const { code, out } = await run(s.repo.main, []);
    expect(code).toBe(1);
    expect(out).toBe("Lint is off: lint.enabled is false in squeal.config.json.\n");
    expect(JSON.parse((await run(s.repo.main, ["--json"])).out)).toEqual({
      v: 1,
      available: false,
      message: "Lint is off: lint.enabled is false in squeal.config.json.",
    });
    expect(existsSync(lintStorePath(s.repo.commonDir))).toBe(false);
  });

  it("refuses an unknown option, and lists itself in the help", async () => {
    const s = seed({});
    const wrong = await run(s.repo.main, ["--told"]);
    expect(wrong.code).toBe(2);
    expect(wrong.err).toContain('squeal lint: unknown option "--told"');
    let help = "";
    await main(["lint", "--help"], { stdout: (t) => (help += t), stderr: () => {} });
    expect(help).toContain("squeal lint [<path>...] [--changed] [--json]");
  });
});
