import { mkdirSync, writeFileSync } from "node:fs";
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
 * Row 023-13 (fix A), `023 research/glob-membership.md` S5b with the real
 * Vitest adapter: CI records and exports at a commit whose `src/plugins/`
 * holds one file, in an environment equal to the developer's. A clone at a
 * commit that adds a matching file imports the export: the pass must not be
 * imported for it. The clone at the export's own commit is the control.
 */

const TEST = "test/registry.test.ts";
const COUNTS: CheckId = { kind: "test", project: "", testPath: TEST, fullName: "counts one" };
const PLUGIN = "src/plugins/new.ts";

const FILES: Record<string, string> = {
  "package.json": JSON.stringify({ name: "glob-import", private: true, type: "module" }),
  "vitest.config.ts": `import { defineConfig } from "vitest/config";\nexport default defineConfig({ test: { include: ["test/**/*.test.ts"] } });\n`,
  "src/plugins/kept.ts": 'export const name = "kept";\n',
  "src/registry.ts":
    'const plugins = import.meta.glob("./plugins/*.ts", { eager: true });\nexport const count = Object.keys(plugins).length;\n',
  [TEST]: `import { expect, it } from "vitest";\nimport { count } from "../src/registry.ts";\nit("counts one", () => expect(count).toBe(1));\n`,
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

/** A clone of `origin` named `name`, `add` committed, the export imported, then its daemon's first, lookup-only start. */
async function imported(origin: string, file: string, name: string, add: boolean) {
  const root = cloneOf(origin, name);
  if (add) {
    mkdirSync(dirname(join(root, PLUGIN)), { recursive: true });
    writeFileSync(join(root, PLUGIN), 'export const name = "new";\n');
    git(root, ["add", "-A"]);
    git(root, ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "add new"]);
  }
  // S5b: imported before the first start, which keys from the stored list the import added.
  const said = io(root);
  expect(await importCommand([file], said), said.out.join("")).toBe(0);
  const common = join(root, ".git");
  // As the daemon the parity tests compare with CI: observing, with Squeal's coverage provider.
  const h = await openHarness(root, openRepoStore(common), common, {
    observe: true,
    coverage: daemonCoverage(),
  });
  await h.scheduler.start();
  await h.quiet();
  const state = h.sink.stateOf(COUNTS);
  expect(h.runsOf(TEST)).toEqual([]);
  await h.scheduler.close();
  await h.runner.close();
  return state;
}

describe("a CI import and a glob's folder membership (row 023-13)", () => {
  it("imports the pass at the export's commit, and not at one that adds a matching file", {
    timeout: 300_000,
  }, async () => {
    const origin = committed(scratch("glob-import"), FILES);
    const file = await exported(origin);
    expect(await imported(origin, file, "same", false)).toMatchObject({
      outcome: "pass",
      validity: "current",
    });
    expect(await imported(origin, file, "added", true)).not.toMatchObject({
      outcome: "pass",
      validity: "current",
    });
  });
});
