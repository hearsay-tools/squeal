// 011-143 probe: the repository's config plus the coverage setup file. Throwaway.
import { mergeConfig } from "vitest/config";
import base from "./vitest.config.ts";
export default mergeConfig(base, { test: { setupFiles: ["./el143-cov-setup.ts"] } });
