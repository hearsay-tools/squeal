import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
import { n } from "./lib.js";
test("type-checks its directory", () => {
  expect(n).toBe(1);
  execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "--ignoreConfig", "--noEmit", "--strict", "--skipLibCheck", "cases/tsc/lib.ts"], { stdio: "pipe" });
}, 60000);
