// Throwaway: lets `npx vitest run --config <this file>` find the race probe.
import { defineConfig } from "vitest/config";

export default defineConfig({ test: { include: ["**/*.probe.ts"] } });
