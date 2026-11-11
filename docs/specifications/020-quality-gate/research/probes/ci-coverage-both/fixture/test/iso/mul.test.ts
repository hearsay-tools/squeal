import { expect, test } from "vitest";
import { mul } from "../../src/mul";
test("multiplies", () => expect(mul(2, 3)).toBe(6));
