import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COVERAGE_PROVIDER_VERSION, coverageOn } from "../../../src/core/code/coverage/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/*
 * Row 015-89: a project that does not set `coverage.enabled` keys its
 * node:test checks as one that sets it false, which spec 015 D8 **Keys**
 * keeps byte-identical to 0.1.354's (the validity case "a run with coverage
 * off keeps the last release's keys and outputs"). The adapter takes
 * `coverageOn` of the policy the worktree's file loads to, as the daemon
 * hands it over (`daemon.ts`); `true` gives Squeal's marker, as in 0.1.358.
 * The Vitest twin is `test/runners/vitest/coverage-default.test.ts`.
 */

const SLOW = { timeout: 60_000 } as const;

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A one-file project's `resolvedConfig` with `policy` as its squeal.config.json. */
async function resolved(policy: object): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "squeal-coverage-default-"));
  temps.push(root);
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "package.json"), `${JSON.stringify({ type: "module" })}\n`);
  writeFileSync(
    join(root, "test/a.test.mjs"),
    'import { test } from "node:test";\ntest("a", () => {});\n',
  );
  writeFileSync(join(root, "squeal.config.json"), `${JSON.stringify(policy)}\n`);
  const adapter = await createNodeTestAdapter(
    { name: "unit", argv: [], env: {}, include: ["test/*.test.mjs"] },
    {
      root,
      tempDir: root,
      coverage: { enabled: () => coverageOn(loadPolicy(root).policy), collected: () => {} },
    },
  );
  try {
    const [environment] = await adapter.environment();
    return environment?.resolvedConfig ?? "";
  } finally {
    await adapter.close();
  }
}

describe("the node:test key of a project that does not set coverage.enabled (row 015-89)", () => {
  it("is the key with coverage.enabled false; true adds the marker", SLOW, async () => {
    const unset = await resolved({});
    expect(unset).not.toBe("");
    expect(unset).toBe(await resolved({ coverage: { enabled: false } }));
    const on = JSON.parse(await resolved({ coverage: { enabled: true } })) as { coverage: unknown };
    expect(on.coverage).toEqual({ provider: "squeal", version: COVERAGE_PROVIDER_VERSION });
    expect({ ...on, coverage: null }).toEqual({ ...JSON.parse(unset), coverage: null });
  });
});
