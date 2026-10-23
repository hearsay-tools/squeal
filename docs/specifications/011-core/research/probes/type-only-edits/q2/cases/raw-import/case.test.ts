import { expect, test } from "vitest";
import text from "./lib.ts?raw";
test("imports its source text with ?raw", () => { expect(text).toContain(": number"); });
