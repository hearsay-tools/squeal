import { describe, expect, it } from "vitest";
import { COVERAGE_PROVIDER_VERSION, coverageOn } from "../../../src/core/code/coverage/index.js";
import { loadPolicy } from "../../../src/core/daemon/policy.js";
import { covering } from "./coverage-helpers.js";
import { openFixture, SLOW } from "./helpers.js";

/* Omitted and empty coverage settings use the same provider marker as
 * explicit true. Explicit false and complexity false keep coverage off.
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

describe("the Vitest key of a project that does not set coverage.enabled", () => {
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
    expect(off.coverage).toMatchObject({ enabled: false });
    expect({ ...JSON.parse(on), coverage: null }).toEqual({ ...off, coverage: null });
    for (const config of [{}, { coverage: {} }, { coverage: { enabled: true } }]) {
      expect(JSON.parse(await resolved({ ...config, complexity: { enabled: false } }))).toEqual(
        off,
      );
    }
  });
});
