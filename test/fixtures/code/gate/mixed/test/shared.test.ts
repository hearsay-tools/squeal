import { expect, it } from "vitest";
import { fromVitest } from "../src/shared";

it("from Vitest", () => expect(fromVitest(3)).toBe(3));
