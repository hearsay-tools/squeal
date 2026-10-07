import { expect, test } from "vitest";
import { inl } from "inl";
test("inl", () => expect(inl()).toBe("inl+inltrans-v1"));
