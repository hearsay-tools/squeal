import { expect, test } from "vitest";
import { esm } from "../src.js";
test("esm", () => expect(esm()).toBe("esm+trans-v1"));
