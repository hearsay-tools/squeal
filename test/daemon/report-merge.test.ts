import { describe, expect, it } from "vitest";
import { merge } from "../../src/core/daemon/composite-runner.js";
import type { RunReport } from "../../src/core/types/runner.js";
import {
  A,
  B,
  C,
  duration,
  EMPTY,
  env,
  fileError,
  focus,
  parts,
  result,
  seen,
  setupFailure,
  skip,
} from "./report-merge-fixture.js";

/*
 * The report merge (GLOSSARY.md; row 011-330): one rule per `RunReport`
 * field. A cell compares whole reports with `toStrictEqual`, so a key
 * present or absent is part of it. Each part sets only its row's field over
 * an empty report; every other field of the merged report stays empty.
 */

/** One cell: each part's `K` over an empty report, and the merged report's `K`. */
interface Case<K extends keyof RunReport> {
  readonly name: string;
  readonly parts: readonly Partial<Pick<RunReport, K>>[];
  readonly merged: Partial<Pick<RunReport, K>>;
}

/** Rows for every field: a `RunReport` field with none fails the typecheck. */
const TABLE: { readonly [K in keyof RunReport]-?: readonly Case<K>[] } = {
  end: [
    { name: "one part's", parts: [{ end: "timed-out" }], merged: { end: "timed-out" } },
    {
      name: "a later part's worse end",
      parts: [{}, { end: "timed-out" }],
      merged: { end: "timed-out" },
    },
    {
      name: "the worst of three, an earlier one",
      parts: [{ end: "crashed" }, { end: "timed-out" }, {}],
      merged: { end: "crashed" },
    },
  ],
  durationMs: [
    { name: "one part's", parts: [{ durationMs: 7 }], merged: { durationMs: 7 } },
    {
      name: "summed over two",
      parts: [{ durationMs: 7 }, { durationMs: 5 }],
      merged: { durationMs: 12 },
    },
    {
      name: "summed over three",
      parts: [{ durationMs: 7 }, { durationMs: 5 }, { durationMs: 1 }],
      merged: { durationMs: 13 },
    },
  ],
  completedFiles: [
    { name: "one part's", parts: [{ completedFiles: [A] }], merged: { completedFiles: [A] } },
    {
      name: "in the parts' order, not sorted",
      parts: [{ completedFiles: [C] }, { completedFiles: [B] }],
      merged: { completedFiles: [C, B] },
    },
    {
      name: "over three, one empty",
      parts: [{ completedFiles: [C] }, { completedFiles: [] }, { completedFiles: [A, B] }],
      merged: { completedFiles: [C, A, B] },
    },
  ],
  results: [
    { name: "one part's", parts: [{ results: [result(A)] }], merged: { results: [result(A)] } },
    {
      name: "in the parts' order",
      parts: [{ results: [result(C)] }, { results: [result(A)] }],
      merged: { results: [result(C), result(A)] },
    },
    {
      name: "over three, one empty",
      parts: [{ results: [result(A)] }, { results: [] }, { results: [result(B), result(C)] }],
      merged: { results: [result(A), result(B), result(C)] },
    },
  ],
  fileErrors: [
    {
      name: "one part's",
      parts: [{ fileErrors: [fileError(A)] }],
      merged: { fileErrors: [fileError(A)] },
    },
    {
      name: "a later part's",
      parts: [{ fileErrors: [] }, { fileErrors: [fileError(C)] }],
      merged: { fileErrors: [fileError(C)] },
    },
    {
      name: "over three, in the parts' order",
      parts: [
        { fileErrors: [fileError(C)] },
        { fileErrors: [fileError(A)] },
        { fileErrors: [fileError(B)] },
      ],
      merged: { fileErrors: [fileError(C), fileError(A), fileError(B)] },
    },
  ],
  failure: [
    {
      name: "one part's, named by its adapter",
      parts: [{ failure: "run exceeded 1000 ms" }],
      merged: { failure: "vitest: run exceeded 1000 ms" },
    },
    {
      name: "only the failing part named",
      parts: [{ failure: null }, { failure: "node exited with signal SIGSEGV" }],
      merged: { failure: "node-test: node exited with signal SIGSEGV" },
    },
    {
      name: "the failing parts joined in order",
      parts: [{ failure: "first" }, {}, { failure: "third" }],
      merged: { failure: "vitest: first; pytest: third" },
    },
  ],
  fileDurations: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    {
      name: "present when a part has them, even empty",
      parts: [{ fileDurations: [] }],
      merged: { fileDurations: [] },
    },
    {
      name: "a later part's",
      parts: [{}, { fileDurations: [duration(C)] }],
      merged: { fileDurations: [duration(C)] },
    },
    {
      name: "over three, one without",
      parts: [{ fileDurations: [duration(A)] }, {}, { fileDurations: [duration(B)] }],
      merged: { fileDurations: [duration(A), duration(B)] },
    },
  ],
  observed: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    {
      name: "present when a part has them, even empty",
      parts: [{ observed: [] }],
      merged: { observed: [] },
    },
    {
      name: "a later part's",
      parts: [{}, { observed: [seen(C)] }],
      merged: { observed: [seen(C)] },
    },
    {
      name: "over three, one without",
      parts: [{ observed: [seen(A)] }, {}, { observed: [seen(B)] }],
      merged: { observed: [seen(A), seen(B)] },
    },
  ],
  reads: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    {
      name: "present when a part has them, even empty",
      parts: [{ reads: [] }],
      merged: { reads: [] },
    },
    { name: "a later part's", parts: [{}, { reads: [seen(C)] }], merged: { reads: [seen(C)] } },
    {
      name: "over three, one without",
      parts: [{ reads: [seen(A)] }, {}, { reads: [seen(B)] }],
      merged: { reads: [seen(A), seen(B)] },
    },
  ],
  environmentObserved: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    { name: "absent when every list is empty", parts: [{ environmentObserved: [] }], merged: {} },
    {
      name: "a later part's",
      parts: [{}, { environmentObserved: [env("node")] }],
      merged: { environmentObserved: [env("node")] },
    },
    {
      name: "over three, one empty, not joined by project",
      parts: [
        { environmentObserved: [env("node")] },
        { environmentObserved: [] },
        { environmentObserved: [env("node")] },
      ],
      merged: { environmentObserved: [env("node"), env("node")] },
    },
  ],
  skippedFiles: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    { name: "absent when every list is empty", parts: [{ skippedFiles: [] }], merged: {} },
    {
      name: "a later part's",
      parts: [{}, { skippedFiles: [skip(C)] }],
      merged: { skippedFiles: [skip(C)] },
    },
    {
      name: "over three, one empty",
      parts: [{ skippedFiles: [skip(A)] }, { skippedFiles: [] }, { skippedFiles: [skip(C)] }],
      merged: { skippedFiles: [skip(A), skip(C)] },
    },
  ],
  withheld: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    { name: "absent when every list is empty", parts: [{ withheld: [] }], merged: {} },
    { name: "a later part's", parts: [{}, { withheld: [C] }], merged: { withheld: [C] } },
    {
      name: "over three, one empty",
      parts: [{ withheld: [B] }, { withheld: [] }, { withheld: [A] }],
      merged: { withheld: [B, A] },
    },
  ],
  focused: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    { name: "absent when every list is empty", parts: [{ focused: [] }], merged: {} },
    {
      name: "a later part's, a zero match included",
      parts: [{}, { focused: [focus(C, 0)] }],
      merged: { focused: [focus(C, 0)] },
    },
    {
      name: "over three, one empty",
      parts: [{ focused: [focus(A, 1)] }, { focused: [] }, { focused: [focus(C, 2)] }],
      merged: { focused: [focus(A, 1), focus(C, 2)] },
    },
  ],
  startupFailure: [
    { name: "absent when no part failed to start", parts: [{}, {}], merged: {} },
    {
      name: "one part's",
      parts: [{ startupFailure: setupFailure("unit", [A]) }],
      merged: { startupFailure: setupFailure("unit", [A]) },
    },
    {
      name: "a later part's when the first started",
      parts: [{}, { startupFailure: setupFailure("node", [C]) }],
      merged: { startupFailure: setupFailure("node", [C]) },
    },
    {
      name: "the first of two parts that each failed to start (task 001-382)",
      parts: [
        { startupFailure: setupFailure("unit", [A]) },
        { startupFailure: setupFailure("node", [C]) },
      ],
      merged: { startupFailure: setupFailure("unit", [A]) },
    },
    {
      name: "the first among three",
      parts: [
        {},
        { startupFailure: setupFailure("node", [C]) },
        { startupFailure: setupFailure("unit", [A]) },
      ],
      merged: { startupFailure: setupFailure("node", [C]) },
    },
  ],
  startedProjects: [
    { name: "absent when no part has them", parts: [{}, {}], merged: {} },
    { name: "absent when every list is empty", parts: [{ startedProjects: [] }], merged: {} },
    {
      name: "one part's, sorted",
      parts: [{ startedProjects: ["unit", "node"] }],
      merged: { startedProjects: ["node", "unit"] },
    },
    {
      name: "each project once over two",
      parts: [{ startedProjects: ["unit"] }, { startedProjects: ["node", "unit"] }],
      merged: { startedProjects: ["node", "unit"] },
    },
    {
      name: "over three, one without",
      parts: [{ startedProjects: ["web"] }, {}, { startedProjects: ["node"] }],
      merged: { startedProjects: ["node", "web"] },
    },
  ],
};

const CELLS = Object.entries(TABLE).flatMap(
  ([field, cases]: [string, readonly Case<keyof RunReport>[]]) =>
    cases.map((cell) => ({ field, ...cell })),
);

describe("the report merge, one rule per field (row 011-330)", () => {
  it.each(CELLS)("$field: $name", ({ parts: fields, merged }) => {
    expect(merge(parts(fields))).toStrictEqual({ ...EMPTY, ...merged });
  });
});
