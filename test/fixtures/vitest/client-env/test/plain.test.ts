import { expect, it } from "vitest";

it("runs in the client environment", () => expect(typeof window).toBe("undefined"));
