import { expect, it } from "vitest";
import { twice } from "./other.js";
it("twice", () => { expect(twice(2)).toBe(4); });
