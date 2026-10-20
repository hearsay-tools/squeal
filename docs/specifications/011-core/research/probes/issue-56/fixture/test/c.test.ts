import { execFileSync } from "node:child_process";
import { expect, test } from "vitest";

// As cezarion's pi-default-tools.test.ts: the subject reaches the test only through a child.
const url = new URL("../scripts/c.mjs", import.meta.url).href;
test("c: the script's default export answers 1", () => {
  const out = execFileSync(process.execPath, [
    "--input-type=module",
    "--eval",
    `import register from '${url}'; console.log(register());`,
  ], { encoding: "utf8" });
  expect(out.trim()).toBe("1");
});
