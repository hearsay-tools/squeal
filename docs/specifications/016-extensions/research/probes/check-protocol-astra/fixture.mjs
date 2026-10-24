// Throwaway protocol fixture. One failure is deliberate.
import test from "node:test";

test("passes", () => {});
test("fails", () => { throw new Error("deliberate probe failure"); });
test("skips", { skip: "probe skip" }, () => {});
