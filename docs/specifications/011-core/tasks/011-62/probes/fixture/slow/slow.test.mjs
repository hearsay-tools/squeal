import { test } from "node:test";

test("slow passes after 8 s", async () => {
  await new Promise((resolve) => setTimeout(resolve, 8000));
});
