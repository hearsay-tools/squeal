import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { importCommand } from "../../src/cli/import.js";
import type { CliIo } from "../../src/cli/main.js";
import type { CheckId } from "../../src/core/types/check.js";
import { git } from "../hash/git-repo.js";
import { openRepoStore } from "../scheduler/repo.js";
import { openHarness } from "../scheduler/vitest-harness.js";
import { daemonCoverage } from "./export-harness.js";
import { ci, cloneOf, committed, recordVitest, scratch } from "./fixture.js";

/*
 * Row 023-14, `023 research/glob-membership.md` S7 through a CI import, with
 * the real Vitest adapter: CI records and exports at a commit where `#reg`
 * maps to `src/reg-a.ts`. A clone at a commit that retargets the entry
 * imports the export: that test's pass must not be imported, and the other
 * test's is. The clone at the export's own commit is the control. The
 * shard's evidence holds the manifests (018 D9), so the export keeps both.
 */

const REG = "test/reg.test.ts";
const COUNT = "test/registry.test.ts";
const READS_A: CheckId = { kind: "test", project: "", testPath: REG, fullName: "reads a" };
const COUNTS: CheckId = { kind: "test", project: "", testPath: COUNT, fullName: "counts one" };

const manifest = (target: string) =>
  `${JSON.stringify({ name: "resolution-import", private: true, type: "module", imports: { "#reg": target, "#chosen": "@w/one" } })}\n`;

/** Reviews/wave-4.md B1 and B2: a test per chain into a workspace package, each expecting "a". */
const CHAINS = {
  b1: { path: "test/b1.test.ts", specifier: "#chosen" },
  b2: { path: "test/b2.test.ts", specifier: "@w/two/sub" },
  b2add: { path: "test/b2add.test.ts", specifier: "@w/three/sub" },
} as const;
type ChainName = keyof typeof CHAINS;
const readsA = (name: ChainName): CheckId => ({
  kind: "test",
  project: "",
  testPath: CHAINS[name].path,
  fullName: "reads a",
});
const json = (data: unknown) => `${JSON.stringify(data)}\n`;
const pkg = (name: string, extra: Record<string, unknown> = {}) =>
  json({ name, private: true, type: "module", ...extra });
const value = (v: string) => `export const value = "${v}";\n`;

/** The one manifest change per chain that makes its import read "b". */
const CHANGES: Readonly<Record<ChainName, Record<string, string>>> = {
  b1: { "packages/one/package.json": pkg("@w/one", { exports: "./b.ts" }) },
  b2: { "packages/two/sub/package.json": json({ type: "module", main: "./b.ts" }) },
  b2add: { "packages/three/sub/package.json": json({ type: "module", main: "./b.ts" }) },
};

/** Workspace links, relative so a clone keeps them: `node_modules/@w/<name>` to `packages/<name>`. */
function links(root: string): void {
  mkdirSync(join(root, "node_modules/@w"), { recursive: true });
  for (const name of ["one", "two", "three"]) {
    symlinkSync(`../../packages/${name}`, join(root, "node_modules/@w", name));
  }
}

const FILES: Record<string, string> = {
  "package.json": manifest("./src/reg-a.ts"),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/reg-a.ts": 'export const value = "a";\n',
  "src/reg-b.ts": 'export const value = "b";\n',
  "src/registry.ts": "export const count = 1;\n",
  [REG]:
    'import { expect, it } from "vitest";\nimport { value } from "#reg";\nit("reads a", () => expect(value).toBe("a"));\n',
  [COUNT]:
    'import { expect, it } from "vitest";\nimport { count } from "../src/registry.ts";\nit("counts one", () => expect(count).toBe(1));\n',
  "packages/one/package.json": pkg("@w/one", { exports: "./a.ts" }),
  "packages/one/a.ts": value("a"),
  "packages/one/b.ts": value("b"),
  "packages/two/package.json": pkg("@w/two"),
  "packages/two/sub/package.json": json({ type: "module", main: "./a.ts" }),
  "packages/two/sub/a.ts": value("a"),
  "packages/two/sub/b.ts": value("b"),
  "packages/three/package.json": pkg("@w/three"),
  "packages/three/sub/index.ts": value("a"),
  "packages/three/sub/b.ts": value("b"),
  ...Object.fromEntries(
    Object.values(CHAINS).map(({ path, specifier }) => [
      path,
      `import { expect, it } from "vitest";\nimport { value } from "${specifier}";\nit("reads a", () => expect(value).toBe("a"));\n`,
    ]),
  ),
};

function io(cwd: string): CliIo & { out: string[] } {
  const out: string[] = [];
  const add = (text: string) => out.push(text);
  return { out, cwd, env: {}, stdout: add, stderr: add };
}

/** CI's export of `origin`'s commit, recorded with `CI` unset so the environments are equal. */
async function exported(origin: string): Promise<string> {
  const job = cloneOf(origin, "ci");
  const parts = join(dirname(origin), "parts");
  const recorded = await recordVitest(job, parts, ["--update=none"], { CI: "" });
  expect(recorded.code, recorded.said).toBe(0);
  const file = join(dirname(origin), "results.json.gz");
  const made = await ci(["export", "--parts", parts, "--out", file], job, {
    ...process.env,
    CI: "",
  });
  expect(made.code, made.said).toBe(0);
  return file;
}

/** A clone of `origin` named `name`, `change` committed, the export imported, then its daemon's first, lookup-only start. */
async function imported(
  origin: string,
  file: string,
  name: string,
  change: Readonly<Record<string, string>>,
) {
  const root = cloneOf(origin, name);
  if (Object.keys(change).length > 0) {
    for (const [path, text] of Object.entries(change)) writeFileSync(join(root, path), text);
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", name]);
  }
  const said = io(root);
  expect(await importCommand([file], said), said.out.join("")).toBe(0);
  const common = join(root, ".git");
  const h = await openHarness(root, openRepoStore(common), common, {
    observe: true,
    coverage: daemonCoverage(),
  });
  await h.scheduler.start();
  await h.quiet();
  const states = {
    reg: h.sink.stateOf(READS_A),
    count: h.sink.stateOf(COUNTS),
    b1: h.sink.stateOf(readsA("b1")),
    b2: h.sink.stateOf(readsA("b2")),
    b2add: h.sink.stateOf(readsA("b2add")),
  };
  const tests = [REG, COUNT, ...Object.values(CHAINS).map((c) => c.path)];
  expect(tests.flatMap((t) => h.runsOf(t))).toEqual([]);
  await h.scheduler.close();
  await h.runner.close();
  return states;
}

const CURRENT_PASS = { outcome: "pass", validity: "current" };

describe("a CI import and what decides an import's resolution (row 023-14)", () => {
  it("imports the passes at the export's commit, and not the retargeted one", {
    timeout: 300_000,
  }, async () => {
    const origin = committed(scratch("resolution-import"), FILES, links);
    const file = await exported(origin);
    const same = await imported(origin, file, "same", {});
    // The control: every pass, the chains' included, is imported at the export's own content.
    expect(same).toMatchObject({
      reg: CURRENT_PASS,
      count: CURRENT_PASS,
      b1: CURRENT_PASS,
      b2: CURRENT_PASS,
      b2add: CURRENT_PASS,
    });

    const retargeted = await imported(origin, file, "retargeted", {
      "package.json": manifest("./src/reg-b.ts"),
    });
    expect(retargeted.reg).not.toMatchObject(CURRENT_PASS);
    expect(retargeted.count).toMatchObject(CURRENT_PASS);
  });

  it.each(Object.keys(CHANGES) as ChainName[])(
    "reviews/wave-4.md: does not import %s's pass at a commit that changes a manifest on its chain",
    { timeout: 300_000 },
    async (chain) => {
      const origin = committed(scratch(`resolution-${chain}`), FILES, links);
      const file = await exported(origin);
      const changed = await imported(origin, file, chain, CHANGES[chain]);
      expect(changed[chain]).not.toMatchObject(CURRENT_PASS);
      const others = (Object.keys(CHAINS) as ChainName[]).filter((c) => c !== chain);
      for (const other of [...others, "reg", "count"] as const) {
        expect(changed[other], other).toMatchObject(CURRENT_PASS);
      }
    },
  );
});
