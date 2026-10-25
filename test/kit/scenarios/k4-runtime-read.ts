import type { Scenario } from "./types.js";

/**
 * K4: a runtime read outside the static closure is observed. The test file
 * loads its module by a path computed at run time, so only the run can see
 * it; the static closure lacks it first, or the scenario proves nothing.
 */
export const K4: Scenario = {
  name: "K4",
  title: "a runtime read outside the static closure is observed",
  modules: {
    hidden: { kind: "value", value: 1 },
    loads: { kind: "computed", check: "loads", from: "hidden", expect: 1 },
  },
  steps: [
    { lacks: "hidden", of: ["loads"] },
    { run: true, expect: { loads: "pass" } },
    { edit: "hidden", to: { kind: "value", value: 2 }, reaches: ["loads"] },
    { run: true, expect: { loads: "fail" } },
  ],
};
