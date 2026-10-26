import { defineConfig } from "vitest/config";
export default defineConfig({ test: { name: "dom", environment: "jsdom", include: ["probe.spec-102.js"] } });
