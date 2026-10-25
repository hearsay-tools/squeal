import type { Scenario } from "./types.js";

/** K6: an installed dependency changes (007 wave 2 B1, 003 wave 3 B1 and B2). */
export const K6: Scenario = {
  name: "K6",
  title: "an installed dependency changes",
  modules: {
    dep: { kind: "dependency", value: 1 },
    uses: { kind: "test", check: "uses", from: "dep", expect: 1 },
  },
  steps: [
    { run: true, expect: { uses: "pass" } },
    { edit: "dep", to: { kind: "dependency", value: 2 }, reaches: ["uses"] },
    { run: true, expect: { uses: "fail" } },
  ],
};
