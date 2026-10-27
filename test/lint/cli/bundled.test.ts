import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FakeProvider } from "../pass/helpers.js";
import { deliveryOf, runLint, type WiredRig, wiredRig } from "../wiring/rig.js";
import { sameRevisionRig } from "./same-revision-rig.js";

/*
 * Review 0.1.360 B2 in the committed CLI bundles: each plugin's
 * `dist/cli/squeal.mjs lint --changed` prints what the source CLI prints.
 * A worker tree does not build, so this fails there until the bundles are
 * built again.
 */

const REPO = join(import.meta.dirname, "../../..");
const BUNDLES = ["claude-code", "codex", "opencode", "pi"].map((plugin): [string, string] => [
  plugin,
  join(REPO, "plugins", plugin === "codex" ? "codex-runtime" : plugin, "dist/cli/squeal.mjs"),
]);
const SESSION = { CLAUDE_CODE_SESSION_ID: "s1" };
const STALE = "an input changed since it was linted; linting resumes when the agent is idle";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

/** `bundle lint <args>` in the rig's worktree, with a HOME of its own. */
function bundled(bundle: string, rig: Pick<WiredRig, "repo">, args: string[]) {
  const home = mkdtempSync(join(tmpdir(), "squeal-lint-bundle-"));
  homes.push(home);
  const run = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", bundle, "lint", ...args],
    {
      cwd: rig.repo.main,
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", HOME: home, ...SESSION },
    },
  );
  return { code: run.status, out: run.stdout };
}

/** Case A: a PASS change, then a config change that makes the file fail. */
async function caseA() {
  const provider = new FakeProvider();
  provider.off.add("no-console");
  const rig = await wiredRig(
    { "src/a.js": "bad no-unused-vars\nbad no-console\n" },
    { alive: false, provider },
  );
  await deliveryOf(rig).register(rig.consumer("s1"));
  await rig.edit({ "src/a.js": "bad no-console\n" });
  provider.off.clear();
  await rig.edit({ "eslint.config.js": "export default [{ rules: {} }];\n" });
  return rig;
}

/** Case B: a whole-program file's PASS change, stale after another file's edit. */
async function caseB() {
  const provider = new FakeProvider();
  provider.wholeProgram.add("src/a.js");
  const rig = await wiredRig(
    { "src/a.js": "bad no-undef\n", "src/b.js": "ok\n" },
    { alive: false, provider, idleIn: () => 60_000 },
  );
  await deliveryOf(rig).register(rig.consumer("s1"));
  await rig.edit({ "src/a.js": "ok\n" });
  await rig.edit({ "src/b.js": "ok\nok\n" });
  return rig;
}

const HEAD = "Lint: 1 file changed since this session started";

describe.each(BUNDLES)("the %s bundle's squeal lint --changed (review 0.1.360 B2)", (_, bundle) => {
  it.each([
    [9, "pass"],
    [9, "fail"],
    [10, "pass"],
    [10, "fail"],
  ] as const)(
    "keeps same-revision history and current state apart with ESLint %i (%s)",
    async (major, history) => {
      const { rig, change } = await sameRevisionRig(major, history);
      const expected = `${HEAD}\n${change}; now fail: 1 finding, linted at revision 2\n`;
      expect(bundled(bundle, rig, ["--changed"])).toEqual({ code: 0, out: expected });
      expect(JSON.parse(bundled(bundle, rig, ["--changed", "--json"]).out)).toEqual(
        await rig.changedJson(),
      );
    },
    60_000,
  );

  it.each([
    ["A", caseA, "now fail: 1 finding, linted at revision 3"],
    ["B", caseB, `now pass: no findings, linted at revision 2 (${STALE})`],
  ])(
    "case %s: tells a PASS change with the state now, as the source does",
    async (_, made, now) => {
      const rig = await made();
      const source = await runLint(rig.repo.main, ["--changed"], SESSION);
      expect(source.out).toBe(
        `${HEAD}\n  PASS lint: src/a.js: no findings; at revision 2; ${now}\n`,
      );
      expect(bundled(bundle, rig, ["--changed"])).toEqual({ code: 0, out: source.out });
      const json = await runLint(rig.repo.main, ["--changed", "--json"], SESSION);
      expect(JSON.parse(bundled(bundle, rig, ["--changed", "--json"]).out)).toEqual(
        JSON.parse(json.out),
      );
    },
  );
});
