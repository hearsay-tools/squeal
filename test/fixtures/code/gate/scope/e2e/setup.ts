import { appendFileSync } from "node:fs";

/** The browser project's setup: it marks the file the test names, when one is named. */
export default function setup(): void {
  const marker = process.env.SQUEAL_GATE_SCOPE_MARKER;
  if (marker !== undefined) appendFileSync(marker, "browser-setup\n");
}
