import { expect, test } from "vitest";
import { value3 } from "../src/m3";
test("m3", () => { expect(value3(2)).toBe(2 * 3); });
