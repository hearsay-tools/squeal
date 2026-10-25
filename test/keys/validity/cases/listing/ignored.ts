import type { Case } from "../../case.js";

/*
 * Row 016-23: a listing of a git-ignored directory that another worktree's
 * run stored, read back by this one. The watcher sees no file in the
 * directory, so the candidate keys the listing by the names on disk here,
 * where a release before keyed it as none. An absent directory keys as a
 * marker (row 016-26), where a release before keyed it as none too, and a
 * tracked directory keys by its tracked names at both.
 */

const TEST = "test/a.test.ts";

const FILES = {
  ".gitignore": "ignored/\n*.log\n",
  "squeal.config.json": `${JSON.stringify({ observe: { runtimeInputs: true } })}\n`,
  "src/app.ts": "export const app = 1;\n",
  [TEST]: "import '../src/app';\n",
};

const listing = (path: string) => ({ observed: [{ path: TEST, paths: [path] }] });

const INPUT = {
  files: FILES,
  environment: {
    project: "",
    runnerName: "validity",
    runnerVersion: "1",
    adapterVersion: "1",
    resolvedConfig: "{}",
    files: [],
  },
  closures: [{ path: TEST, imports: ["src/app.ts"] }],
  elsewhere: listing("ignored/list/"),
} as const;

export const IGNORED_LISTING: readonly Case[] = [
  {
    kind: "assemble",
    name: "a listing of an ignored directory another worktree stored, read back",
    why: "016-23: the names the ignored directory holds here key the test file; a release before keyed the listing as none, so the keys differ and a result stored under the old key is not inherited",
    input: {
      ...INPUT,
      untracked: { "ignored/list/a.json": "1\n", "ignored/list/b.json": "2\n" },
    },
  },
  {
    kind: "assemble",
    name: "a listing of an ignored directory absent here, read back",
    why: "016-26: an absent directory keys as a marker, where a release before keyed it as none, as 0.1.313 keyed the directory present; so the keys differ, and a result stored before 0.1.316 with the directory present is not inherited where it is absent",
    input: INPUT,
  },
  {
    kind: "assemble",
    name: "a listing of a tracked directory another worktree stored, read back",
    why: "016-23: a directory the watcher sees a file in keys by its tracked names, as before, its ignored names not among them (a residual), so the keys are equal at both trees and nothing re-keys",
    input: {
      ...INPUT,
      untracked: { "src/ignored.log": "1\n" },
      elsewhere: listing("src/"),
    },
  },
];
