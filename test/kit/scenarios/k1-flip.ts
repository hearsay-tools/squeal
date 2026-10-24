import type { Scenario } from "./types.js";

/** K1: a source edit flips a test, then it recovers. */
export const K1: Scenario = {
  name: "K1",
  title: "a source edit flips a test, then it recovers",
  modules: {
    leaf: { kind: "value", value: 1 },
    direct: { kind: "test", check: "direct", from: "leaf", expect: 1 },
  },
  steps: [
    { run: true, expect: { direct: "pass" } },
    { edit: "leaf", to: { kind: "value", value: 2 }, reaches: ["direct"] },
    { run: true, expect: { direct: "fail" } },
    { edit: "leaf", to: { kind: "value", value: 1 }, reaches: ["direct"] },
    { run: true, expect: { direct: "pass" } },
  ],
};
