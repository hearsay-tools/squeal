import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** Where the rates service (scripts/rates-service.mjs) writes the port it listens on. */
export const PORT_FILE = join(homedir(), ".ledgerline-rates.port");

/** Today's exchange rate from `from` to `to`, from the rates service on this machine. */
export async function rate(from: string, to: string): Promise<number> {
  let port: string;
  try {
    port = readFileSync(PORT_FILE, "utf8").trim();
  } catch {
    throw new Error(
      `the rates service is not running (no ${PORT_FILE}); start it with: node scripts/rates-service.mjs`,
    );
  }
  const response = await fetch(`http://127.0.0.1:${port}/v1/rates/${from}/${to}`);
  if (!response.ok)
    throw new Error(`the rates service answered ${response.status} ${response.statusText}`);
  return ((await response.json()) as { rate: number }).rate;
}
