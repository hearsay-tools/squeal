import { defineConfig } from "vitest/config";

// The project's own testTimeout, far above Vitest's 5 s: the gate must not lower it.
export default defineConfig({ test: { include: ["test/**/*.test.ts"], testTimeout: 900_000 } });
