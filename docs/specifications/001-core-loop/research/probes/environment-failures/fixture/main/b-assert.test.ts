import { expect, test } from "vitest";
test("asserts wrongly", () => expect(1 + 1).toBe(3));
test("passes beside it", () => expect(2).toBe(2));
