import { defineConfig } from "vitest/config";

// Row 015-11: the fixture of 015-01's coverage probe, run with Squeal's own provider.
export default defineConfig({ test: { include: ["test/**/*.test.ts"] } });
