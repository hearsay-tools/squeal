// One jsdom variant per VARIANT: where the provider sits and how its path is written.
import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { defineConfig } from "vitest/config";

const outside = process.env.PROVIDER;
const variant = process.env.VARIANT;
let customProviderModule = outside;
let server;
if (variant === "inside-root") {
  customProviderModule = join(process.cwd(), ".squeal-probe", "provider.mjs");
  mkdirSync(dirname(customProviderModule), { recursive: true });
  cpSync(outside, customProviderModule);
} else if (variant === "file-url") {
  customProviderModule = pathToFileURL(outside).href;
} else if (variant === "fs-allow") {
  server = { fs: { allow: [process.cwd(), dirname(outside)] } };
} else if (variant === "fs-strict-off") {
  server = { fs: { strict: false } };
}
export default defineConfig({
  server,
  test: {
    environment: process.env.ENV ?? "jsdom",
    include: ["probe.spec-102.js"],
    coverage: { enabled: true, provider: "custom", customProviderModule, reporter: [], reportsDirectory: process.env.REPORTS },
  },
});
