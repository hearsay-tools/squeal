import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";
test("child with a cleared environment", () => {
  const out = execFileSync(process.execPath, ["-e", "process.stdout.write(require('data-pkg') && 'ok')"], { env: {} });
  expect(String(out)).toBe("ok");
});
