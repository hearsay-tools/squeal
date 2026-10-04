export { checkKey } from "./check-key.js";
export {
  assembleClosure,
  CLOSURE_METHOD,
  normalizeRelativePath,
  selectDeclaredInputs,
} from "./closure.js";
export {
  type CoreEnvironmentOptions,
  coreEnvironmentInputs,
  environmentHash,
  findInstalledLockfile,
  type InstalledLockfile,
  installedDependenciesFingerprint,
} from "./environment.js";
export { createInputMatcher, globToRegExp } from "./glob.js";
export { type ClosureUpdate, type KeyChange, KeyIndex } from "./key-index.js";
export { closuresToReresolve } from "./resolution.js";
export { directoryOf, ReverseIndex, testFileId } from "./reverse-index.js";
