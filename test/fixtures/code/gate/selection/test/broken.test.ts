import { expect, it } from "vitest";
import { broken } from "../src/broken";

// Throws at import, after the source loaded: a file-level error, no test name.
if (broken(1) === 2) throw new Error("broken at import");

it("never collected", () => expect(broken(1)).toBe(2));
