import { describe, expect, it } from "vitest";
import { COVERAGE_PROVIDER_VERSION, coverageOn } from "../../../src/core/code/coverage/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, SLOW } from "./helpers.js";

/*
 * Row 015-89: a project that does not set `coverage.enabled` keys its Vitest
 * checks as one that sets it false, which spec 015 D8 **Keys** keeps
 * byte-identical to the keys before coverage. The adapter takes `coverageOn`
 * of the policy the worktree's file loads to, as the daemon hands it over
 * (`daemon.ts`); `true` gives Squeal's marker, as in 0.1.358. The node:test
 * twin is `test/runners/node-test/coverage-default.test.ts`.
 */

/** The fixture's `resolvedConfig` with `policy` as its squeal.config.json. */
async function resolved(policy: object): Promise<string> {
  const files = { "squeal.config.json": `${JSON.stringify(policy)}\n` };
  const fx = await openFixture("own-provider", files, (root) =>
    covering({ on: () => coverageOn(loadPolicy(root).policy) }).create(root),
  );
  const [environment] = await fx.adapter.environment();
  return environment?.resolvedConfig ?? "";
}

describe("the Vitest key of a project that does not set coverage.enabled (row 015-89)", () => {
  it("is the key with coverage.enabled false; true adds the marker", SLOW, async () => {
    const unset = await resolved({});
    expect(unset).not.toBe("");
    expect(unset).toBe(await resolved({ coverage: { enabled: false } }));
    const on = JSON.parse(await resolved({ coverage: { enabled: true } })) as { coverage: unknown };
    expect(on.coverage).toEqual({ provider: "squeal", version: COVERAGE_PROVIDER_VERSION });
    expect({ ...on, coverage: null }).toEqual({ ...JSON.parse(unset), coverage: null });
  });
});
