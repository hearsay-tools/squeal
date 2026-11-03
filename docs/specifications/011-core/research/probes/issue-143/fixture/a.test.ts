import { expect, test } from "vitest";
import { value } from "./helper";
test("a", () => { expect(value()).toBe(1); });
