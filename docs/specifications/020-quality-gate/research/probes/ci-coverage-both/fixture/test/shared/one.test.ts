import { expect, test } from "vitest";
import { twice } from "../../src/shared";
import { add } from "../../src/add";
test("twice", () => expect(twice(2)).toBe(4));
test("add in shared", () => expect(add(5, 5)).toBe(10));
