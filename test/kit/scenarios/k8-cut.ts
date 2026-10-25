import type { Scenario } from "./types.js";

/**
 * K8: a run is interrupted or cut mid-file, and nothing it wrote counts.
 * The held file passes one check, then holds in the next until the driver
 * sees its started file and cuts the run for the cause its pack names, so
 * no clock decides where the cut falls. The check that passed is no
 * result: its file did not complete. Then the file runs whole.
 */
export const K8: Scenario = {
  name: "K8",
  title: "a run is cut mid-file, and nothing it wrote counts",
  modules: {
    leaf: { kind: "value", value: 1 },
    cut: { kind: "held", check: "cut", holds: "holds" },
  },
  steps: [
    { run: true, cut: "cut", expect: { cut: "unknown" } },
    {
      edit: "cut",
      to: { kind: "test", check: "cut", from: "leaf", expect: 1 },
      reaches: ["cut"],
    },
    { run: true, expect: { cut: "pass" } },
  ],
};
