import { existsSync } from "node:fs";
import { test } from "vitest";
const flag = `${process.env.ISSUE66_SCRATCH ?? "/tmp/issue66-probe"}/slow-flag`;
test("slow only when flagged", async () => {
  if (existsSync(flag)) await new Promise((r) => setTimeout(r, 6000));
}, 20000);
