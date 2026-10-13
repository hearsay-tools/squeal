import { execFileSync } from "node:child_process";
import { cezarionShaped, cleanupFixtures, squealShaped } from "../cli/setup/fixture.js";
import { fixtureInstall } from "../e2e/install.js";
import { type Machine, ok } from "./machine.js";

/*
 * The two fixture shapes of spec 005's end-to-end tests, made runnable: the
 * files of `squealShaped` and `cezarionShaped` (row 005-12), each test file a
 * real test that keeps the strings setup reads as evidence: Vitest's here, and
 * in cezarion's shape node:test's under `test/` (`node --import tsx --test`,
 * as cezarion runs them) with Vitest kept to `src/`. Built here under /tmp,
 * then copied by `tar` into the case as the throwaway user, with
 * `node_modules` linked to a copy of the e2e suite's cached install (the
 * node:test one, which holds tsx beside Vitest, for cezarion).
 */

export type Shape = "squeal" | "cezarion";

const passing = (strings: readonly string[]) =>
  `import { expect, test } from "vitest";
const named = ${JSON.stringify(strings)};
test("names its artifacts", () => {
  expect(named.length).toBe(${strings.length});
});
`;

const nodeTest = (strings: readonly string[]) =>
  `import assert from "node:assert/strict";
import { test } from "node:test";
const named: string[] = ${JSON.stringify(strings)};
test("names its artifacts", () => {
  assert.equal(named.length, ${strings.length});
});
`;

const INSTALL: Readonly<Record<Shape, "vitest" | "node-test">> = {
  squeal: "vitest",
  cezarion: "node-test",
};

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
      "vitest.config.ts": `export default { test: { include: ["packages/*/src/**/*.test.ts"] } };\n`,
      "packages/cezar/test/e2e/update.test.ts": nodeTest([
        "../../dist/application-update/service.js",
      ]),
      "packages/cezar/test/e2e/package-cli.test.ts": nodeTest(["web/dist/index.html"]),
      "packages/cezar/test/unit/a.test.ts": nodeTest([]),
      "packages/cezar/src/workflows/monitoring-turn.test.ts": passing([]),
    }),
};

const tarOf = (dir: string, ...paths: string[]) =>
  execFileSync("tar", ["-c", "-C", dir, ...paths], { maxBuffer: 1 << 30 });

const deps = new WeakMap<Machine, Map<string, Promise<string>>>();

/** The case's copy of the cached install of `kind`, made once per machine. */
function depsOf(m: Machine, kind: "vitest" | "node-test"): Promise<string> {
  const mine = deps.get(m) ?? new Map<string, Promise<string>>();
  deps.set(m, mine);
  let made = mine.get(kind);
  if (made === undefined) {
    made = (async () => {
      const install = await fixtureInstall(kind);
      if (!install.ok) throw new Error(`no ${kind} install for the fixtures: ${install.reason}`);
      const dir = `${m.root}/deps/${kind}`;
      ok(
        await m.run("tar", ["-x", "-C", dir], {
          input: tarOf(install.dir, "node_modules"),
          cwd: dir,
          timeoutMs: 300_000,
        }),
        `copy the ${kind} install`,
      );
      return `${dir}/node_modules`;
    })();
    mine.set(kind, made);
  }
  return made;
}

let made = 0;

/** A fixture repository of `shape` in the case, owned by the throwaway user; its path. */
export async function fixture(m: Machine, shape: Shape): Promise<string> {
  const local = BUILD[shape]();
  const dest = `${m.root}/fx/${shape}-${++made}`;
  try {
    ok(
      await m.run("tar", ["-x", "-C", dest], { input: tarOf(local, "."), cwd: dest }),
      `copy the ${shape} fixture`,
    );
  } finally {
    cleanupFixtures();
  }
  ok(
    await m.run("ln", ["-s", await depsOf(m, INSTALL[shape]), "node_modules"], { cwd: dest }),
    "link Vitest",
  );
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
