import { describe, expect, it } from "vitest";
import { resolveGroups } from "../../src/core/daemon/check-groups.js";
import { useLoad } from "./checks-load.js";

/*
 * Row 019-47 (spec 019 D1 as amended 2026-11-05): the fifth moment,
 * `manual`, sorted last. A group at it is kept (each kind: `checks.test.ts`)
 * and Stop never requires one; a group at an earlier moment that names one
 * in `after` is left out, since that group would wait for it forever.
 */

const load = useLoad();
const leftOut = (name: string, why: string) => `"checks" group "${name}": ${why}; it is left out`;
const PARITY = { name: "parity", runner: "vitest", tests: ["**/*-parity.test.ts"], at: "manual" };
const LINT = { name: "slowlint", lint: true, at: "manual" };

describe("a group at `manual` (spec 019 D1, row 019-47)", () => {
  it("keeps a test and a lint group at `manual`, neither required by Stop", () => {
    const { policy, problems } = load({ checks: [PARITY, LINT] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([PARITY, LINT]);
    const resolved = resolveGroups(policy).filter((group) => group.index !== null);
    expect(resolved.map(({ name, at, stopRequires }) => ({ name, at, stopRequires }))).toEqual([
      { name: "parity", at: "manual", stopRequires: false },
      { name: "slowlint", at: "manual", stopRequires: false },
    ]);
  });

  it.each(["edit", "pause", "stop", "commit"])(
    "leaves out a group at %s whose after names a `manual` group",
    (at) => {
      const follower = {
        name: "unit",
        runner: "vitest",
        tests: ["test/**"],
        at,
        after: ["parity"],
      };
      const { policy, problems } = load({ checks: [PARITY, follower] });
      expect(problems).toEqual([
        leftOut("unit", `"after" names "parity", a group at "manual", later than its own "${at}"`),
      ]);
      expect(policy.checks).toEqual([PARITY]);
    },
  );

  it("lets a `manual` group follow a group at an earlier moment or another `manual` group", () => {
    const unit = { name: "unit", runner: "vitest", tests: ["test/unit/**"], at: "edit" };
    const after = { name: "py", runner: "pytest", at: "manual", after: ["unit", "parity"] };
    const { policy, problems } = load({ checks: [unit, PARITY, after] });
    expect(problems).toEqual([]);
    expect(policy.checks).toEqual([unit, PARITY, after]);
  });
});
