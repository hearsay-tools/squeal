import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { deriveRoots } from "../../../../src/runners/pytest/graph/derive-roots.js";

const FIXTURES = join(import.meta.dirname, "../../../fixtures/pytest");

function derived(name: string) {
  const root = join(FIXTURES, name);
  const roots = deriveRoots(root);
  return {
    pthPaths: roots.pthPaths.map((p) => relative(root, p)),
    mapped: roots.mapped.map((m) => [m.module, relative(root, m.path), m.finder]),
    notes: roots.notes,
  };
}

describe("deriveRoots (spec 007 D4, from 007-04)", () => {
  it("equals what uv sync wrote for every backend layout, in .pth file-name order", () => {
    // 007-04's results/layouts.actual.json, read from the synced environment on 3.10 and 3.13.
    expect(derived("layouts")).toEqual({
      pthPaths: [
        "vendor/pathed/src",
        "packages/sfind/lib",
        "packages/hauto/src",
        "packages/pdmb/src",
        "src",
        "packages/flitm/src",
        "packages/poet/source",
        "packages/uvflat",
      ],
      mapped: [["sflat", "packages/sflat/sflat", "setuptools"]],
      notes: [],
    });
  });

  it("equals what uv sync wrote for the small fixture", () => {
    expect(derived("small")).toEqual({
      pthPaths: ["packages/other/src", "src"],
      mapped: [],
      notes: [],
    });
  });
});
