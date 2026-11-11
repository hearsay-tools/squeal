import { describe, expect, it } from "vitest";
import { loadPolicy, POLICY_FILE } from "../../src/core/daemon/policy.js";
import { DEFAULT_POLICY } from "../../src/core/types/policy.js";
import { rootWith } from "./helpers.js";

/* Spec 018 D18 (row 018-30): `node`, which Node the daemon runs on. */

function load(file: unknown) {
  return loadPolicy(rootWith({ [POLICY_FILE]: JSON.stringify(file) }));
}

describe("policy node (018 D18)", () => {
  it('is "project" by default: the pinned Node when it is installed', () => {
    expect(DEFAULT_POLICY.node).toBe("project");
    const { policy, problems } = load({});
    expect(problems).toEqual([]);
    expect(policy.node).toBe("project");
  });

  it.each(["project", "session"])("takes %s", (node) => {
    const { policy, problems } = load({ node });
    expect(problems).toEqual([]);
    expect(policy.node).toBe(node);
  });

  it.each([["pinned"], [null], [true], [{ version: "26" }]])(
    "reports %j as a problem, and the default applies",
    (node) => {
      const { policy, problems } = load({ node });
      expect(policy.node).toBe("project");
      expect(problems).toEqual([
        `"node" must be "project" or "session", got ${JSON.stringify(node)}`,
      ]);
    },
  );
});
