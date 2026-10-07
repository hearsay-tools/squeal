import { defineConfig } from "vitest/config";
import magic from "plugin-pkg";
export default defineConfig({
  plugins: [magic()],
  test: {
    setupFiles: ["./setup.js"],
    globalSetup: ["./global-setup.js"],
    server: { deps: { inline: ["inl"] } },
  },
});
