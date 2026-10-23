import { expect, test } from "vitest";
import { boom } from "./lib.js";
test("fails in both variants", () => { boom(); expect(1).toBe(1); });
