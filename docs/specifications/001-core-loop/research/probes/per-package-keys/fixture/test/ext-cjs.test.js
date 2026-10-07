import { expect, test } from "vitest";
import { cjs } from "ext-cjs";
test("cjs", () => expect(cjs()).toBe("cjs+phantom-v1"));
