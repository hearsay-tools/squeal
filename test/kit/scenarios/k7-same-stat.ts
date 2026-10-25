import type { Scenario } from "./types.js";

/**
 * K7: an edit keeps the file size and the whole-second mtime (row 007-29,
 * found on one runner: a cache keyed by size and mtime ran the old code).
 * The edit sets the mtime back with `utimes`, so no clock decides it.
 */
export const K7: Scenario = {
  name: "K7",
  title: "an edit keeps the file size and the whole-second mtime",
  modules: {
    leaf: { kind: "value", value: 1 },
    direct: { kind: "test", check: "direct", from: "leaf", expect: 1 },
  },
  steps: [
    { run: true, expect: { direct: "pass" } },
    { edit: "leaf", to: { kind: "value", value: 2 }, reaches: ["direct"], sameStat: true },
    { run: true, expect: { direct: "fail" } },
    { edit: "leaf", to: { kind: "value", value: 1 }, reaches: ["direct"], sameStat: true },
    { run: true, expect: { direct: "pass" } },
  ],
};
