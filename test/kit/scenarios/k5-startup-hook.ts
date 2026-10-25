import type { Scenario } from "./types.js";

/**
 * K5: a startup hook loads a module by a computed path (003 wave 2 B1,
 * 007 wave 2 B5). No static closure holds the module, so only the run can
 * see it. Each pack plays its hook forms as variants.
 */
export const K5: Scenario = {
  name: "K5",
  title: "a startup hook loads a module by a computed path",
  modules: {
    hidden: { kind: "value", value: 1 },
    setup: { kind: "hook", from: "hidden" },
    hooked: { kind: "test", check: "hooked", from: "setup", expect: 1 },
  },
  steps: [
    { lacks: "hidden", of: ["hooked"] },
    { run: true, expect: { hooked: "pass" } },
    { edit: "hidden", to: { kind: "value", value: 2 }, reaches: ["hooked"] },
    { run: true, expect: { hooked: "fail" } },
  ],
};
