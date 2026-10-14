// cezar shape: a file-level beforeAll finds the browser provider missing.
import { beforeAll, expect, test } from "vitest";
beforeAll(() => {
  throw new Error("cezar e2e: the agent-browser provider is not installed (no binary on PATH)");
});
test("first", () => expect(1).toBe(1));
test("second", () => expect(1).toBe(1));
