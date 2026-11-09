import { test, expect } from "vitest";
test.only("focused", () => expect(1).toBe(1));
test("other, would fail", () => expect(1).toBe(2));
