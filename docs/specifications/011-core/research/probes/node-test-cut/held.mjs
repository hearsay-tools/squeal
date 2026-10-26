import { writeFileSync } from "node:fs";
import { test } from "node:test";
test("cut", () => {});
test("holds", async () => {
  writeFileSync(new URL("../holds.started", import.meta.url), "");
  await new Promise((done) => setTimeout(done, 600_000));
});
