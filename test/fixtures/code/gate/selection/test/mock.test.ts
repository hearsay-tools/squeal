import { hostname } from "node:os";
import { describe, expect, it, vi } from "vitest";
import { viaDep } from "../src/via-dep";

vi.mock("../src/dep", () => ({ dep: () => 41 }));
vi.mock("node:os", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:os")>();
  return { ...real, hostname: () => "h" };
});

describe("mocks", () => {
  it("dep", () => expect(viaDep()).toBe(42));
  it("os", () => expect(hostname()).toBe("h"));
});
