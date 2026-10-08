import { defineConfig } from "vitest/config";
export default defineConfig({ test: { tags: [{ name: "slow", timeout: 120_000 }] } });
