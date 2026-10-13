import { execFileSync } from "node:child_process";
import { cezarionShaped, cleanupFixtures, squealShaped } from "../cli/setup/fixture.js";
import { fixtureInstall } from "../e2e/install.js";
import { type Machine, ok } from "./machine.js";

/*
 * The two fixture shapes of spec 005's end-to-end tests, made runnable: the
 * files of `squealShaped` and `cezarionShaped` (row 005-12), each test file a
 * real Vitest test that keeps the strings setup reads as evidence. Built here
 * under /tmp, then copied by `tar` into the case as the throwaway user, with
 * `node_modules` linked to a copy of the e2e suite's cached Vitest install.
 */

export type Shape = "squeal" | "cezarion";

const passing = (strings: readonly string[]) =>
  `import { expect, test } from "vitest";
const named = ${JSON.stringify(strings)};
test("names its artifacts", () => {
  expect(named.length).toBe(${strings.length});
});
`;

const BUILD: Readonly<Record<Shape, () => string>> = {
  squeal: () =>
    squealShaped({
      "test/e2e/plugin-copy.test.ts": passing([
        "plugins/codex/dist/cli/squeal.mjs",
        "dist/cli/squeal.mjs",
      ]),
      "test/e2e/shipped-plugin.test.ts": passing(["dist/cli/squeal.mjs"]),
      "test/cli/main.test.ts": passing([]),
    }),
  cezarion: () =>
    cezarionShaped({
      "packages/cezar/test/e2e/update.test.ts": passing([
        "../../dist/application-update/service.js",
      ]),
      "packages/cezar/test/e2e/package-cli.test.ts": passing(["web/dist/index.html"]),
      "packages/cezar/test/unit/a.test.ts": passing([]),
      "packages/cezar/src/workflows/monitoring-turn.test.ts": passing([]),
    }),
};

const tarOf = (dir: string, ...paths: string[]) =>
  execFileSync("tar", ["-c", "-C", dir, ...paths], { maxBuffer: 1 << 30 });

const deps = new WeakMap<Machine, Promise<string>>();

/** The case's copy of the cached Vitest install, made once per machine. */
function vitestOf(m: Machine): Promise<string> {
  let made = deps.get(m);
  if (made === undefined) {
    made = (async () => {
      const install = await fixtureInstall("vitest");
      if (!install.ok) throw new Error(`no Vitest for the fixtures: ${install.reason}`);
      const dir = `${m.root}/deps`;
      ok(
        await m.run("tar", ["-x", "-C", dir], {
          input: tarOf(install.dir, "node_modules"),
          cwd: dir,
          timeoutMs: 300_000,
        }),
        "copy the Vitest install",
      );
      return `${dir}/node_modules`;
    })();
    deps.set(m, made);
  }
  return made;
}

/** A fixture repository of `shape` in the case, owned by the throwaway user; its path. */
export async function fixture(m: Machine, shape: Shape): Promise<string> {
  const local = BUILD[shape]();
  const dest = `${m.root}/fx/${shape}`;
  try {
    ok(
      await m.run("tar", ["-x", "-C", dest], { input: tarOf(local, "."), cwd: dest }),
      `copy the ${shape} fixture`,
    );
  } finally {
    cleanupFixtures();
  }
  ok(await m.run("ln", ["-s", await vitestOf(m), "node_modules"], { cwd: dest }), "link Vitest");
  return dest;
}

/** Runs recorded in the fixture's store, every worktree; 0 without a store. */
export async function runCount(m: Machine, root: string): Promise<number> {
  const r = await m.run(
    "node",
    [
      "--no-warnings",
      "-e",
      `const fs = require("node:fs");
const path = process.argv[1];
if (!fs.existsSync(path)) { console.log(0); process.exit(0); }
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync(path, { readOnly: true });
console.log(db.prepare("SELECT COUNT(*) AS n FROM runs").get().n);`,
      `${root}/.git/squeal/store.sqlite`,
    ],
    { cwd: root },
  );
  return Number(ok(r, "count runs").stdout.trim());
}
