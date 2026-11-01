import { expect, test } from "vitest";

const extra: { size: number } = { size: 2 };
const entry = { size: 1, ...extra };

test("the spread wins at runtime", () => {
  expect(entry.size).toBe(2);
});
