import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
test("child", () => {
  const out = execFileSync(process.execPath, ["-e", "process.stdout.write(require('child-pkg').child())"]);
  expect(String(out)).toBe("child-v1");
});
