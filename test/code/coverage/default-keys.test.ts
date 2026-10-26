import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { COVERAGE_PROVIDER_VERSION, coverageOn } from "../../../src/core/code/coverage/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { createNodeTestAdapter } from "../../../src/runners/node-test/adapter.js";
import { covering } from "../../runners/vitest/coverage-helpers.js";
import { openFixture, SLOW } from "../../runners/vitest/helpers.js";

/*
 * Row 015-89: a project that does not set `coverage.enabled` keys its Vitest
 * and node:test checks as one that sets it false, which spec 015 D8 **Keys**
 * keeps byte-identical to the keys before coverage (the validity cases "a
 * run with coverage off keeps the last release's keys"). Each adapter takes
 * `coverageOn` of the policy the worktree's file loads to, as the daemon
 * hands it over (`daemon.ts`); `true` gives Squeal's marker, as in 0.1.358.
 */

const UNSET = {};
const OFF = { coverage: { enabled: false } };
const ON = { coverage: { enabled: true } };
const MARKER = { provider: "squeal", version: COVERAGE_PROVIDER_VERSION };

const config = (policy: object) => `${JSON.stringify(policy)}\n`;
const enabled = (root: string) => () => coverageOn(loadPolicy(root).policy);

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The Vitest fixture's `resolvedConfig` under `policy`. */
async function vitestConfig(policy: object): Promise<string> {
  const fx = await openFixture("own-provider", { "squeal.config.json": config(policy) }, (root) =>
    covering({ on: enabled(root) }).create(root),
  );
  const [environment] = await fx.adapter.environment();
  return environment?.resolvedConfig ?? "";
}

/** A one-file node:test project's `resolvedConfig` under `policy`. */
async function nodeTestConfig(policy: object): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), "squeal-default-keys-"));
  temps.push(root);
  mkdirSync(join(root, "test"));
  writeFileSync(join(root, "package.json"), config({ name: "keys", type: "module" }));
  writeFileSync(
    join(root, "test/a.test.mjs"),
    'import { test } from "node:test";\ntest("a", () => {});\n',
  );
  writeFileSync(join(root, "squeal.config.json"), config(policy));
  const adapter = await createNodeTestAdapter(
    { name: "unit", argv: [], env: {}, include: ["test/*.test.mjs"] },
    { root, tempDir: root, coverage: { enabled: enabled(root), collected: () => {} } },
  );
  try {
    const [environment] = await adapter.environment();
    return environment?.resolvedConfig ?? "";
  } finally {
    await adapter.close();
  }
}

describe("the keys of a project that does not set coverage.enabled (row 015-89)", () => {
  it.each([
    ["Vitest", vitestConfig],
    ["node:test", nodeTestConfig],
  ] as const)("%s: as with coverage.enabled false; true adds the marker", SLOW, async (_, of) => {
    const unset = await of(UNSET);
    expect(unset).not.toBe("");
    expect(unset).toBe(await of(OFF));
    const on = JSON.parse(await of(ON)) as { coverage?: unknown };
    expect(on.coverage).toEqual(MARKER);
    expect({ ...on, coverage: null }).toEqual({ ...JSON.parse(unset), coverage: null });
  });
});
