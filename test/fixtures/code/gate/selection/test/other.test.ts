import { expect, it } from "vitest";
import { other } from "../src/other";

it("other", () => expect(other(2)).toBe(4));
