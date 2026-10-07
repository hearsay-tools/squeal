import { execFileSync } from "node:child_process";
import { expect, it } from "vitest";

it("runs a child process, which can load any installed package", () => {
  expect(execFileSync(process.execPath, ["-e", "process.stdout.write('ok')"]).toString()).toBe("ok");
});
