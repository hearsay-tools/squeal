import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

/**
 * The holiday calendar is compiled once per version of src/clock.ts and cached
 * on the machine; a cold compile is slow. LEDGERLINE_CALENDAR_WARM=1 skips it.
 */
export async function loadCalendar(): Promise<void> {
  if (process.env.LEDGERLINE_CALENDAR_WARM === "1") return;
  const source = readFileSync(join(root, "src/clock.ts"));
  const key = createHash("sha1").update(root).update(source).digest("hex");
  const dir = join(tmpdir(), "ledgerline-calendar");
  const file = join(dir, key);
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, "compiled\n");
  await new Promise((resolve) => setTimeout(resolve, 600));
}
