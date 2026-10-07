import { test } from "node:test";

test("never returns", () => {
  while (true) {}
});
