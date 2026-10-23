import { expect, test } from "vitest";
import { area } from "./lib.js";
test("side module not loaded", () => { expect(area({ w: 2, h: 3 })).toBe(6); expect((globalThis as any).sideLoaded).toBeUndefined(); });
