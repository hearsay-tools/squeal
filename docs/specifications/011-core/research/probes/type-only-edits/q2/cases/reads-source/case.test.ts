import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { n } from "./lib.js";
test("reads its source text", () => {
  expect(n).toBe(1);
  expect(readFileSync(new URL("./lib.ts", import.meta.url), "utf8")).toContain(": number");
});
