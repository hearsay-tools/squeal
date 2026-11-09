import { test, expect } from "vitest";
test("snap", () => expect({ a: 1 }).toMatchSnapshot());
