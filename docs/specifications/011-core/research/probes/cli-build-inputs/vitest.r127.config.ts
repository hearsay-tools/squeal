// Throwaway probe for 011-127, copied into the clone's root. The repository's config plus the attribution setup file.
import { mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";
export default mergeConfig(base, { test: { setupFiles: ["./r127-attrib.ts"] } });
