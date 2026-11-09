import { expect, it } from "vitest";
import { fast } from "../src/a";

it("fast", () => expect(fast(1)).toBe(1));
