import type { Scenario } from "./types.js";

/** K3: a file fails to load, then recovers. The test file imports a module that stops parsing. */
export const K3: Scenario = {
  name: "K3",
  title: "a file fails to load, then recovers",
  modules: {
    leaf: { kind: "value", value: 1 },
    loads: { kind: "test", check: "loads", from: "leaf", expect: 1 },
  },
  steps: [
    { run: true, expect: { loads: "pass" } },
    { edit: "leaf", to: { kind: "broken" }, reaches: ["loads"] },
    { run: true, expect: { loads: "file-error" } },
    { edit: "leaf", to: { kind: "value", value: 1 }, reaches: ["loads"] },
    { run: true, expect: { loads: "pass" } },
  ],
};
