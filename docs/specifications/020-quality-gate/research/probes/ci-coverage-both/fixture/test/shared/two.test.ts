import { expect, test } from "vitest";
import { twice } from "../../src/shared";
test("twice again", () => expect(twice(3)).toBe(6));
