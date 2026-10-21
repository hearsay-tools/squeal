import { expect, test } from "vitest";
import { value1 } from "../src/m1";
test("m1", () => { expect(value1(2)).toBe(2 * 1); });
