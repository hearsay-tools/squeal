import { expect, inject, test } from "vitest";
test("setup", () => expect(globalThis.SETUP_VALUE).toBe("setup-v1"));
test("globalSetup", () => expect(inject("gs")).toBe("gs-v1"));
test("plugin", () => expect(__MAGIC__).toBe("magic-v1"));
