import { randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { NodeTestProject } from "../../../src/core/types/policy.js";
import { runNodeTest } from "../../../src/runners/node-test/run/run.js";

/*
 * Spec 025 D7.2, live: a node:test file, and so what it spawns, gets no
 * NODE_COMPILE_CACHE from Squeal's launchers; a user's or the project's own
 * reaches it.
 */

const ROOT = realpathSync(resolve(import.meta.dirname, "../../fixtures/node-test"));
const SLOW = { timeout: 60_000 } as const;
const logs = mkdtempSync(join(tmpdir(), "squeal-node-test-cache-"));
const scratch = join(ROOT, ".tmp", randomUUID());
afterAll(() => {
  rmSync(logs, { recursive: true, force: true });
  rmSync(scratch, { recursive: true, force: true });
});

const TEST = `import { test } from "node:test";
const e = process.env;
test("cache " + (e.NODE_COMPILE_CACHE ?? "none") + " own " + (e.SQUEAL_OWN_COMPILE_CACHE ?? "none"), () => {});
`;

async function seen(env: NodeJS.ProcessEnv, projectEnv: Record<string, string> = {}) {
  const dir = join(scratch, randomUUID());
  mkdirSync(join(dir, "test"), { recursive: true });
  writeFileSync(join(dir, "test", "cache.test.mjs"), TEST);
  const cwd = `.tmp/${scratch.split("/").pop()}/${dir.split("/").pop()}`;
  const project = { name: "cache", cwd, argv: [], env: projectEnv, include: ["**/*.test.mjs"] };
  const { report } = await runNodeTest({
    root: ROOT,
    logDir: join(logs, randomUUID()),
    timeoutMs: 30_000,
    project: project as NodeTestProject,
    files: [{ project: "cache", path: `${cwd}/test/cache.test.mjs` }],
    env,
  });
  return report.results.map((r) => `${r.check.fullName}: ${r.outcome}`);
}

describe("node:test and the compile cache (spec 025 D7.2)", () => {
  const { NODE_COMPILE_CACHE: _c, SQUEAL_OWN_COMPILE_CACHE: _o, ...base } = process.env;
  const own = join(logs, "squeal-cache");
  const mine = join(logs, "my-cache");

  it("leaves out Squeal's own", SLOW, async () => {
    const env = { ...base, NODE_COMPILE_CACHE: own, SQUEAL_OWN_COMPILE_CACHE: "1" };
    expect(await seen(env)).toEqual(["cache none own none: pass"]);
  });

  it("keeps a user's, and the project's own over Squeal's", SLOW, async () => {
    expect(await seen({ ...base, NODE_COMPILE_CACHE: mine })).toEqual([
      `cache ${mine} own none: pass`,
    ]);
    const env = { ...base, NODE_COMPILE_CACHE: own, SQUEAL_OWN_COMPILE_CACHE: "1" };
    expect(await seen(env, { NODE_COMPILE_CACHE: mine })).toEqual([`cache ${mine} own none: pass`]);
  });
});
