import type { Scenario } from "./types.js";

/** K9: a test imports a missing file, then the file is created. */
export const K9: Scenario = {
  name: "K9",
  title: "a test imports a missing file, then the file is created",
  modules: {
    later: { kind: "absent" },
    needs: { kind: "test", check: "needs", from: "later", expect: 1 },
  },
  steps: [
    { run: true, expect: { needs: "file-error" } },
    { edit: "later", to: { kind: "value", value: 1 }, reaches: ["needs"] },
    { run: true, expect: { needs: "pass" } },
  ],
};
