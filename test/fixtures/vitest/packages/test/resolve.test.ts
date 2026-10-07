import { readFileSync } from "node:fs";
import { expect, it } from "vitest";

// Review wave-11b B2: `require.resolve` finds a package file no import names.
declare const require: { resolve(id: string): string };

it("reads a package file found by require.resolve", () => {
  expect(readFileSync(require.resolve("data-pkg/data.json"), "utf8")).toMatch(/data-/);
});
