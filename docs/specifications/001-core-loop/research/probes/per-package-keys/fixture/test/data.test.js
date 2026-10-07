import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { expect, test } from "vitest";
test("data", () => {
  const path = createRequire(import.meta.url).resolve("data-pkg/data.json");
  expect(JSON.parse(readFileSync(path, "utf8")).value).toBe("data-v1");
});
