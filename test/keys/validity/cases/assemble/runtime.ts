import type { Case } from "../../case.js";

const A = "test/a.test.ts";
const B = "test/outside.test.ts";
const DATA = ".runtime/port.json";
const rule = { project: "", tests: [A], paths: [DATA] };
const policy = { runtimeFiles: [rule] };
const environment = {
  project: "",
  runnerName: "fixture",
  runnerVersion: "1",
  adapterVersion: "1",
  resolvedConfig: "{}",
  files: ["setup.mjs"],
};
const base = {
  files: {
    ".gitignore": ".runtime/\n",
    "squeal.config.json": JSON.stringify(policy),
    [A]: "// A\n",
    [B]: "// B\n",
    "setup.mjs": "// setup\n",
  },
  untracked: { [DATA]: "1234\n" },
  environment,
  closures: [
    { path: A, imports: [] },
    { path: B, imports: [] },
  ],
};
export const RUNTIME_FILES: readonly Case[] = [
  {
    kind: "assemble",
    name: "uninspectable exact runtime path retains protection",
    why: "gh-105: failed path discovery cannot authorize an exclusion",
    input: {
      ...base,
      files: {
        ...base.files,
        "squeal.config.json": JSON.stringify({
          runtimeFiles: [{ ...rule, paths: [DATA, ".runtime/loop"] }],
        }),
      },
      runtime: { links: { ".runtime/loop": "loop" } },
    },
  },
  {
    kind: "assemble",
    name: "runtime symlink does not exclude its undeclared target",
    why: "gh-105: exclusions are lexical exact paths, with independent protection checks",
    input: {
      ...base,
      files: {
        ...base.files,
        "squeal.config.json": JSON.stringify({
          runtimeFiles: [{ ...rule, paths: [".runtime/link.json"] }],
        }),
      },
      runtime: {
        links: { ".runtime/link.json": "port.json" },
        freshObserved: [{ path: A, paths: [".runtime/link.json"] }],
      },
    },
  },
  {
    kind: "assemble",
    name: "raw-only runtime observation commits after rollback",
    why: "gh-105: raw additions survive an excluded effective growth and transaction rollback",
    input: { ...base, runtime: { freshObserved: [{ path: A, paths: [DATA] }] } },
  },
  {
    kind: "assemble",
    name: "new runtime-only module evidence protects before record",
    why: "gh-105: module evidence prevents an excluded-input result from being accepted",
    input: { ...base, runtime: { freshObserved: [{ path: A, paths: [DATA], modules: [DATA] }] } },
  },
  {
    kind: "assemble",
    name: "runtime declarations cannot hide installed dependency patches",
    why: "gh-105: positive installed identity protects patch bytes",
    input: {
      ...base,
      files: {
        ...base.files,
        "squeal.config.json": JSON.stringify({
          runtimeFiles: [{ ...rule, paths: ["patches/p.patch", DATA] }],
        }),
        "patches/p.patch": "patch\n",
      },
      untracked: {
        ...base.untracked,
        "node_modules/.package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: {} }),
      },
      runtime: {},
    },
  },
  {
    kind: "assemble",
    name: "runtime data, reload removal and restoration, and ordinary readers",
    why: "gh-105: effective inputs vary by reader and contract, shared raw observations survive removal",
    input: {
      ...base,
      cached: [DATA],
      rewritten: { [DATA]: "2345\n" },
      runtime: {
        observed: [
          { path: A, paths: [DATA] },
          { path: B, paths: [DATA] },
        ],
        policies: [{}, policy, { ...policy, inputs: { [A]: [".runtime/**"] } }],
      },
    },
  },
  {
    kind: "assemble",
    name: "runtime module protection and direct evidence",
    why: "gh-105: a runtime declaration never hides a module load",
    input: {
      ...base,
      runtime: { observed: [{ path: A, paths: [DATA], modules: [DATA], direct: [DATA] }] },
    },
  },
  {
    kind: "assemble",
    name: "runtime saved closure is provisional until fresh discovery",
    why: "gh-105: a historical assembled closure cannot authorize runtime exclusions",
    input: {
      ...base,
      runtime: {
        saved: true,
        policies: [
          policy,
          { ...policy, observe: { runtimeInputs: false } },
          { ...policy, observe: { runtimeInputs: true } },
          {},
        ],
      },
    },
  },
  {
    kind: "assemble",
    name: "runtime conflict matrix and selector notes",
    why: "gh-105: declarations, imports, setup, policy and directories override runtime assertions",
    input: {
      ...base,
      files: {
        ...base.files,
        "squeal.config.json": JSON.stringify({
          runtimeFiles: [
            {
              ...rule,
              paths: [
                DATA,
                A,
                "missing.ts",
                "setup.mjs",
                "squeal.config.json",
                ".runtime",
                "package.json",
                "setup.mjs/child",
              ],
            },
            { ...rule, project: "other" },
          ],
        }),
      },
      closures: [{ path: A, imports: ["missing.ts"] }],
      runtime: { observed: [{ path: A, paths: [DATA] }] },
    },
  },
  ...[
    [null],
    [{ ...rule, project: 1 }],
    [{ ...rule, unknown: 1 }],
    [{ ...rule, tests: [] }],
    [{ ...rule, paths: [] }],
    [{ ...rule, tests: ["!"] }],
    [{ ...rule, tests: ["["] }],
    [{ ...rule, paths: ["../bad"] }],
    [{ ...rule, paths: ["./.runtime\\port.json"] }],
  ].map(
    (runtimeFiles, i): Case => ({
      kind: "assemble",
      name: `malformed or normalized runtime rule ${i}`,
      why: "gh-105: invalid entries cannot exclude any input; valid spellings normalize",
      input: {
        ...base,
        files: { ...base.files, "squeal.config.json": JSON.stringify({ runtimeFiles }) },
        runtime: {},
      },
    }),
  ),
];
