import type { Scenario } from "./types.js";

/** K2: an edit two imports away re-runs the dependent file. */
export const K2: Scenario = {
  name: "K2",
  title: "an edit two imports away re-runs the dependent file",
  modules: {
    leaf: { kind: "value", value: 1 },
    mid: { kind: "reexport", from: "leaf" },
    chain: { kind: "test", check: "chain", from: "mid", expect: 1 },
  },
  steps: [
    { run: true, expect: { chain: "pass" } },
    { edit: "leaf", to: { kind: "value", value: 2 }, reaches: ["chain"] },
    { run: true, expect: { chain: "fail" } },
  ],
};
