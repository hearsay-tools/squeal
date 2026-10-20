import type { Case, StoreInput } from "../../case.js";

/*
 * Finished tiers as `recordTier` records them (task 011-37 section 3, the
 * `store` kind): per file, stored and under which key, discarded, queued
 * again, unknown. Together they reach every branch of the per-file decision
 * (`tiers.ts` before 011-40, `store-decision.ts` after it).
 */

const store = (name: string, why: string, input: StoreInput): Case => ({
  kind: "store",
  name,
  why,
  input,
});

const slow = (n: number) => `test/slow${n}.test.ts`;
const SLOW_FILES = [
  { path: slow(1), inputs: [slow(1), "dist/gen.js"] },
  { path: slow(2), inputs: [slow(2)] },
  { path: slow(3), inputs: [slow(3)] },
];

export const STORE_TIERS: readonly Case[] = [
  store(
    "a touch of one file's input (013-01 test 11, T1)",
    "013-02 (D2 of 013-01): the barrier withholds only the file whose key names the touched path; it runs once more (007-30), the others are stored",
    { files: SLOW_FILES, completed: [slow(1), slow(2), slow(3)], touched: ["dist/gen.js"] },
  ),
  store(
    "the same touch on the run once more (013-01 test 11, T2)",
    "013-02 and 007-30: a second withhold at the key leaves that file unknown with the reason naming the path; the others are stored",
    {
      files: SLOW_FILES,
      completed: [slow(1), slow(2), slow(3)],
      touched: ["dist/gen.js"],
      touchedBefore: [slow(1)],
    },
  ),
  store(
    "every per-file outcome of a completed tier",
    "001-107, 001-124, 001-132, 001-134, 003-43, 011-06, 011-21: each branch of the per-file decision but a failed setup's",
    {
      files: [
        { path: "test/stored.test.ts" },
        { path: "test/superseded.test.ts", running: "other" },
        { path: "test/moved-on.test.ts", key: "moved", result: "moved" },
        { path: "test/moved.test.ts", key: "moved" },
        { path: "test/not-held.test.ts", held: false },
        { path: "test/withheld.test.ts" },
        { path: "test/again.test.ts" },
        { path: "test/crashed.test.ts" },
        { path: "test/unstable.test.ts", inputs: ["test/unstable.test.ts", "src/moving.ts"] },
        { path: "test/grew.test.ts", growth: { growth: ["data/read.txt"] } },
        { path: "test/grew-moved.test.ts", key: "moved", growth: { growth: ["data/read.txt"] } },
        {
          path: "test/grew-unstable.test.ts",
          growth: { growth: ["data/moving.txt"] },
        },
        {
          path: "test/first-seen.test.ts",
          growth: { growth: ["data/new.txt"], firstSeen: ["data/new.txt"] },
        },
        { path: "test/environment.test.ts" },
      ],
      completed: [
        "test/stored.test.ts",
        "test/superseded.test.ts",
        "test/moved-on.test.ts",
        "test/moved.test.ts",
        "test/not-held.test.ts",
        "test/withheld.test.ts",
        "test/again.test.ts",
        "test/unstable.test.ts",
        "test/grew.test.ts",
        "test/grew-moved.test.ts",
        "test/grew-unstable.test.ts",
        "test/first-seen.test.ts",
        "test/environment.test.ts",
      ],
      withheld: ["test/withheld.test.ts"],
      requeue: ["test/again.test.ts"],
      changed: ["src/moving.ts", "data/moving.txt"],
      environment: ["test/environment.test.ts"],
    },
  ),
  store(
    "a tier whose global setup failed",
    "001-382: the files the failed setup kept from starting are not started, and wait for the setup",
    {
      files: [{ path: "test/a.test.ts" }, { path: "test/b.test.ts" }],
      completed: [],
      startup: ["test/a.test.ts", "test/b.test.ts"],
    },
  ),
  store(
    "a timed-out tier's files that did not complete",
    "001-179: a timed-out tier of several files queues its incomplete files again in tiers of half as many",
    {
      files: [{ path: "test/a.test.ts" }, { path: "test/b.test.ts" }, { path: "test/c.test.ts" }],
      end: "timed-out",
      completed: ["test/a.test.ts"],
    },
  ),
  store(
    "a backlog tier an edit cancelled",
    "001-124: a file the cancel cut short is queued again uncounted; one that completed is stored",
    {
      files: [{ path: "test/a.test.ts" }, { path: "test/b.test.ts" }],
      cancelled: true,
      completed: ["test/a.test.ts"],
    },
  ),
  store(
    "a tier whose install moved",
    "001-107: the whole tier is queued again uncounted and nothing is stored",
    {
      files: [{ path: "test/a.test.ts" }, { path: "test/b.test.ts" }],
      completed: ["test/a.test.ts", "test/b.test.ts"],
      requeue: true,
    },
  ),
];
