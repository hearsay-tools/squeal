import { expect, test } from "vitest";
import { boom } from "./lib.js";
test("the stack names lib.ts line 2", () => {
  try { boom(); } catch (e) { expect((e as Error).stack).toContain("lib.ts:2:"); }
});
