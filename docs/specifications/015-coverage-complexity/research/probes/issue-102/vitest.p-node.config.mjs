import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "node", environment: "node", include: ["probe.spec-102.js"] } });
