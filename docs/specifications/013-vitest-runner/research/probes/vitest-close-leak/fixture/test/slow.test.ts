import { expect, test } from "vitest";
import { value1 } from "../src/m1";
test("slow", async () => { await new Promise((r) => setTimeout(r, 200)); expect(value1(1)).toBe(1); });
