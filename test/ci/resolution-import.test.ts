import { writeFileSync } from "node:fs";
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

const SHADOWED_COUNT =
  'import { expect, it } from "vitest";\nimport { count } from "../src/registry";\nit("counts one", () => expect(count).toBe(1));\n';

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
  `${JSON.stringify({ name: "resolution-import", private: true, type: "module", imports: { "#reg": target } })}\n`;

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
};

function io(cwd: string): CliIo & { out: string[] } {
  const out: string[] = [];
  const add = (text: string) => out.push(text);
  return { out, cwd, env: {}, stdout: add, stderr: add };
}

/** CI's export of `origin`'s commit, recorded with `CI` unset so the environments are equal. */
async function exported(origin: string, said: (text: string) => void = () => {}): Promise<string> {
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
  said(made.said);
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
  const states = { reg: h.sink.stateOf(READS_A), count: h.sink.stateOf(COUNTS) };
  expect([...h.runsOf(REG), ...h.runsOf(COUNT)]).toEqual([]);
  await h.scheduler.close();
  await h.runner.close();
  return states;
}

const CURRENT_PASS = { outcome: "pass", validity: "current" };

describe("a CI import and what decides an import's resolution (row 023-14)", () => {
  it("imports the passes at the export's commit, and not the retargeted one", {
    timeout: 300_000,
  }, async () => {
    const origin = committed(scratch("resolution-import"), FILES);
    const file = await exported(origin);
    const same = await imported(origin, file, "same", {});
    expect(same.reg).toMatchObject(CURRENT_PASS);
    expect(same.count).toMatchObject(CURRENT_PASS);

    const retargeted = await imported(origin, file, "retargeted", {
      "package.json": manifest("./src/reg-b.ts"),
    });
    expect(retargeted.reg).not.toMatchObject(CURRENT_PASS);
    expect(retargeted.count).toMatchObject(CURRENT_PASS);
  });

  // Open (row 023-14, option A): Vite 8 probes `src/registry.js` in its native resolver, so the
  // shard holds no evidence of its absence and the export leaves the file out (018 D9). A row
  // that records that evidence turns this into an import of the pass.
  it("leaves out a file whose closure holds a shadow path the shard did not probe", {
    timeout: 300_000,
  }, async () => {
    const origin = committed(scratch("resolution-shadow"), { ...FILES, [COUNT]: SHADOWED_COUNT });
    let said = "";
    const file = await exported(origin, (text) => {
      said += text;
    });
    expect(said).toContain(
      "left out test/registry.test.ts: its shard recorded other content, or none, for src/registry,",
    );
    const same = await imported(origin, file, "same", {});
    expect(same.reg).toMatchObject(CURRENT_PASS);
    expect(same.count).toBeNull();
  });
});
