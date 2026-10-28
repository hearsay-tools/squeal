import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COVERAGE_PROVIDER_VERSION, coverageOn } from "../../../src/core/code/coverage/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";

/* Omitted and empty coverage settings use the same provider marker as
 * explicit true. Explicit false and complexity false keep coverage off.
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

describe("the node:test key of a project that does not set coverage.enabled", () => {
  it("defaults to true; explicit false and complexity false omit the marker", SLOW, async () => {
    const on = await resolved({ coverage: { enabled: true } });
    expect(on).not.toBe("");
    expect(await resolved({})).toBe(on);
    expect(await resolved({ coverage: {} })).toBe(on);
    expect(JSON.parse(on).coverage).toEqual({
      provider: "squeal",
      version: COVERAGE_PROVIDER_VERSION,
    });
    const off = JSON.parse(await resolved({ coverage: { enabled: false } }));
    expect(off).not.toHaveProperty("coverage");
    expect({ ...JSON.parse(on), coverage: null }).toEqual({ ...off, coverage: null });
    for (const config of [{}, { coverage: {} }, { coverage: { enabled: true } }]) {
      expect(JSON.parse(await resolved({ ...config, complexity: { enabled: false } }))).toEqual(
        off,
      );
    }
  });
});
