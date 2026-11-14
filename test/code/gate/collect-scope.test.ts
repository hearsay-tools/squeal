import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { collectEvidence } from "../../../src/core/code/gate/collect.js";
import { ADAPTERS, changedSet, project, SLOW, scopeOf, status } from "./collect-fixture.js";
import { quiet } from "./host-load.js";

/*
 * Spec 020 D14.2 (row 020-15a): cezar's shape in #172. A browser spec loads
 * the changed server code through a helper, and its project's global setup
 * writes a marker. Its group, `browser`, is `manual`: by default the file
 * does not run, no setup starts, and its closure still says it loads the
 * changed source. `--group browser`, or `--test` naming it, runs it.
 */

const MARKER = "SQUEAL_GATE_SCOPE_MARKER";
let dir: string;
let marker: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "squeal-gate-scope-"));
  marker = join(dir, "marker");
  process.env[MARKER] = marker;
});
afterEach(() => {
  delete process.env[MARKER];
  rmSync(dir, { recursive: true, force: true });
});

const ran = (files: readonly { path: string; completed: boolean }[]) =>
  files.map((f) => [f.path, f.completed]);

describe("collectEvidence: the scope by check group (spec 020 D14.2)", () => {
  it("leaves out the manual browser file: no run, no setup, its closure read", SLOW, async () => {
    const root = project("scope");
    const before = status(root);
    const evidence = await collectEvidence(root, await changedSet(root, ["src/store.ts"]), {
      hostLoad: quiet,
      tests: [],
      budgetSeconds: 600,
      adapters: ADAPTERS,
      scope: scopeOf(root),
    });
    expect(ran(evidence.testFiles)).toEqual([["test/store.test.ts", true]]);
    expect(existsSync(marker)).toBe(false);
    expect(evidence.scope?.inScope.map((g) => g.name)).toEqual(["tests", "slow"]);
    expect(evidence.scope?.leftOut).toEqual([
      { name: "browser", at: "manual", files: 1, selected: 1, add: "--group browser" },
    ]);
    const [file] = evidence.scope?.files ?? [];
    expect(file).toMatchObject({ runner: "vitest", path: "e2e/page.test.ts", group: "browser" });
    expect(file?.loads).toEqual(expect.arrayContaining(["e2e/helper.ts", "src/store.ts"]));
    expect(status(root)).toBe(before);
  });

  it("runs it, setup included, with --group browser or with --test", SLOW, async () => {
    const root = project("scope");
    const changed = await changedSet(root, ["src/store.ts"]);
    const added = await collectEvidence(root, changed, {
      hostLoad: quiet,
      tests: [],
      budgetSeconds: 600,
      adapters: ADAPTERS,
      scope: scopeOf(root, ["browser"]),
    });
    expect(ran(added.testFiles)).toEqual([
      ["e2e/page.test.ts", true],
      ["test/store.test.ts", true],
    ]);
    expect(added.scope?.inScope.map((g) => [g.name, g.from])).toEqual([
      ["browser", "--group"],
      ["tests", "default"],
      ["slow", "default"],
    ]);
    expect(added.scope?.leftOut).toEqual([]);
    expect(added.scope?.files).toEqual([]);
    expect(readFileSync(marker, "utf8")).toBe("browser-setup\n");

    const named = await collectEvidence(root, changed, {
      hostLoad: quiet,
      tests: ["e2e/page.test.ts"],
      budgetSeconds: 600,
      adapters: ADAPTERS,
      scope: scopeOf(root),
    });
    expect(ran(named.testFiles)).toEqual([
      ["e2e/page.test.ts", true],
      ["test/store.test.ts", true],
    ]);
    expect(named.scope?.files).toEqual([]);
    expect(named.scope?.leftOut).toEqual([
      { name: "browser", at: "manual", files: 1, selected: 0, add: "--group browser" },
    ]);
  });
});
