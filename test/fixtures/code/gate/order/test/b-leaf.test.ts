import { expect, it } from "vitest";
import { leaf } from "../src/leaf";

it("leaf", () => expect(leaf(1)).toBe(2));
