// As cezarion's root config: projects in their own config files, one of them jsdom.
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { projects: ["./vitest.p-dom.config.mjs", "./vitest.p-node.config.mjs"] } });
