// Throwaway probe: the fixture config plus a setup file that marks which test file each process runs.
import base from "./vitest.config.js";
export default { ...base, test: { ...base.test, setupFiles: [...base.test.setupFiles, "../mark.mjs"] } };
