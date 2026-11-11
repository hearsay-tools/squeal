import { expect, test } from "vitest";
import { hasSession } from "../../src/probe-inspector";
test("session", () => expect(hasSession()).toBe(true));
