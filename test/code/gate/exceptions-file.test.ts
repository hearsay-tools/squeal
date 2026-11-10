import { describe, expect, it } from "vitest";
import { parseExceptions } from "../../../src/core/code/gate/exceptions.js";

/*
 * Spec 020 D8 (row 020-09): the file `--exceptions` reads, format
 * `squeal-code-exceptions/1`. A file that does not parse, has another
 * format or an entry that lacks a field gives an error, which the CLI
 * turns into exit 2.
 */

const ENTRY = {
  path: "src/a.ts",
  qualifiedName: "parse",
  bodyHash: "h1",
  measure: "complexity",
  kind: "inherited",
  value: 22,
  issue: "https://github.com/o/r/issues/1",
  approver: "owner",
  baseCommit: "c".repeat(40),
};

const file = (entries: unknown, format: unknown = "squeal-code-exceptions/1") =>
  JSON.stringify({ format, entries });

describe("parseExceptions (spec 020 D8)", () => {
  it("reads every field of each entry, and leaves out keys it does not know", () => {
    const crap = { ...ENTRY, measure: "crap", kind: "approved", value: 30.5, note: "x" };
    expect(parseExceptions(file([ENTRY, crap]))).toEqual([
      ENTRY,
      { ...ENTRY, measure: "crap", kind: "approved", value: 30.5 },
    ]);
    expect(parseExceptions(file([]))).toEqual([]);
  });

  it.each([
    ["{", /^not JSON: /],
    ["[]", /^not a JSON object$/],
    [
      file([], "squeal-code-exceptions/2"),
      /^format is "squeal-code-exceptions\/2", not "squeal-code-exceptions\/1"$/,
    ],
    [JSON.stringify({ entries: [] }), /^format is undefined, not/],
    [file({}), /^entries is not a list$/],
    [file([1]), /^entry 1: not a JSON object$/],
    [file([ENTRY, { ...ENTRY, path: "" }]), /^entry 2: path is not a non-empty string$/],
    [file([{ ...ENTRY, bodyHash: 7 }]), /^entry 1: bodyHash is not a non-empty string$/],
    [
      file([{ ...ENTRY, baseCommit: undefined }]),
      /^entry 1: baseCommit is not a non-empty string$/,
    ],
    [file([{ ...ENTRY, measure: "cc" }]), /^entry 1: measure is not complexity or crap$/],
    [file([{ ...ENTRY, kind: "waived" }]), /^entry 1: kind is not inherited or approved$/],
    [file([{ ...ENTRY, value: -1 }]), /^entry 1: value is not a number at or above 0$/],
    [file([{ ...ENTRY, value: "22" }]), /^entry 1: value is not a number at or above 0$/],
    [file([{ ...ENTRY, issue: "#167" }]), /^entry 1: issue is not a URL$/],
  ])("refuses %s", (text, error) => {
    const parsed = parseExceptions(text);
    expect("error" in parsed && parsed.error).toMatch(error);
  });
});
