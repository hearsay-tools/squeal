import { expect, it } from "vitest";

// Review wave-11d S1: a literal `require` of a types-only package's manifest.
declare const require: (id: string) => { version: string };

it("reads a types-only manifest through a bare require", () => {
  expect(require("@types/probe/package.json").version).toBe("1.0.0");
});
