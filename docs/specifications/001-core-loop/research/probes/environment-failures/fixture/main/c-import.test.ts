import { expect, test } from "vitest";
import { missing } from "./does-not-exist.js";
test("never collected", () => expect(missing).toBe(1));
