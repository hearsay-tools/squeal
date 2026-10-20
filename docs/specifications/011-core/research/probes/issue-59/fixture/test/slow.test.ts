import { expect, test } from "vitest";
// edit: 0
test("slow passes after 8 s", async () => {
  await new Promise((r) => setTimeout(r, 8_000));
  expect(1).toBe(1);
}, 20_000);
