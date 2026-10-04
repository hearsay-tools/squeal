import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { add } from "../src/math.js";

it("adds", () => {
  expect(add(1, 2)).toBe(3);
});

it("matches the data file", () => {
  const data = JSON.parse(readFileSync(new URL("./data/cases.json", import.meta.url), "utf8"));
  expect(add(data.a, data.b)).toMatchSnapshot();
});
