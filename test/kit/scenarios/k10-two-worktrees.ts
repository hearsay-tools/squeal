import type { Scenario, Step } from "./types.js";

/** In the worktree played now, before any run there: what worktree a's run observed is held, and an edit of each path reaches its reader. */
const seen: readonly Step[] = [
  { holds: "hidden", of: ["loads"] },
  { holds: "dep", of: ["spawns"] },
  { edit: "hidden", to: { kind: "value", value: 2 }, reaches: ["loads"] },
  { edit: "dep", to: { kind: "value", value: 2 }, reaches: ["spawns"], direct: ["spawns"] },
];

/**
 * K10: two worktrees share one store (spec 016 D1's later scenario, goal
 * 6). Worktree a's run observes a computed import and a child process's
 * import. Worktree b, which never ran them, and a after a restart hold each
 * in a closure, and an edit of each reaches its test file: in `direct` for
 * the child's import (row 007-56). The last run shows the edited modules
 * are the ones the tests load.
 */
export const K10: Scenario = {
  name: "K10",
  title: "two worktrees share one store",
  modules: {
    hidden: { kind: "value", value: 1 },
    loads: { kind: "computed", check: "loads", from: "hidden", expect: 1 },
    dep: { kind: "value", value: 1 },
    child: { kind: "child", from: "dep" },
    spawns: { kind: "spawns", check: "spawns", child: "child", expect: 1 },
  },
  steps: [
    { lacks: "hidden", of: ["loads"] },
    { lacks: "dep", of: ["spawns"] },
    { run: true, expect: { loads: "pass", spawns: "pass" } },
    { worktree: "b" },
    ...seen,
    { worktree: "a" },
    { restart: true },
    ...seen,
    { run: true, expect: { loads: "fail", spawns: "fail" } },
  ],
};
