import { expect, test } from "vitest";
import { add } from "../../src/add";
test("adds", () => expect(add(1, 2)).toBe(3));
test("negative", () => expect(add(-1, 2)).toBe(-1));
