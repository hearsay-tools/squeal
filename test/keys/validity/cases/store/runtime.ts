import type { Case } from "../../case.js";

const A = "test/a.test.ts";
const contract = JSON.stringify(["squeal-runtime-files/1", [".runtime/port.json"]]);
export const RUNTIME_STORES: readonly Case[] = [
  {
    kind: "store",
    name: "a policy changed while runtime-only observation grew",
    why: "gh-105: observed growth cannot move a run across runtime policy identity",
    input: {
      completed: [A],
      files: [
        { path: A, runtimePolicy: contract, currentRuntimePolicy: "", growth: { growth: [] } },
      ],
    },
  },
  {
    kind: "store",
    name: "a new protected module revokes a runtime exclusion",
    why: "gh-105: a run cannot certify the key that excluded its newly discovered module",
    input: {
      completed: [A],
      files: [
        {
          path: A,
          runtimePolicy: contract,
          currentRuntimePolicy: "",
          growth: { growth: [".runtime/port.json"], firstSeen: [".runtime/port.json"] },
        },
      ],
    },
  },
  {
    kind: "store",
    name: "a raw-only read keeps the same runtime contract",
    why: "gh-105: a raw-only observation persists with no first-seen rerun",
    input: {
      completed: [A],
      files: [
        {
          path: A,
          runtimePolicy: contract,
          currentRuntimePolicy: contract,
          growth: { growth: [] },
        },
      ],
    },
  },
];
