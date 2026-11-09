import { expect, it } from "vitest";
import { changed } from "../src/changed";

it("changed", () => expect(changed(-3)).toBe(3));
