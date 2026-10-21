import { expect, test } from "vitest";
import { value2 } from "../src/m2";
test("m2", () => { expect(value2(2)).toBe(2 * 2); });
