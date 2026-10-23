import { expect, test } from "vitest";
import { f } from "./lib.js";
test("toString shows the comment", () => { expect(f.toString()).toContain("marker"); });
