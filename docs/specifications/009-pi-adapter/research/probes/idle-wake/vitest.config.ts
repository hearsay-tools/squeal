// Throwaway probe config (see README.md): runs only this folder's *.probe.ts.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["docs/specifications/009-pi-adapter/research/probes/idle-wake/*.probe.ts"] },
});
