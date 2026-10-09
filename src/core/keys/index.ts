export { checkKey } from "./check-key.js";
export {
  assembleClosure,
  CLOSURE_METHOD,
  createDeclaredInputs,
  type DeclaredInputs,
  inputGlobs,
  isInputList,
  normalizeRelativePath,
  sameInputs,
  selectDeclaredInputs,
  type UnmatchedInputs,
  unmatchedInputs,
} from "./closure.js";
export { type DependencyKeys, dependencyKeys } from "./dependencies.js";
export {
  type CoreEnvironmentOptions,
  coreEnvironmentInputs,
  environmentHash,
  findInstalledLockfile,
  type InstalledDependencies,
  type InstalledLockfile,
  installedDependencies,
  installedDependenciesFingerprint,
  isInstalledLockfile,
} from "./environment.js";
export { createInputMatcher, globToRegExp } from "./glob.js";
export { artifactGlobs, ignoredInputs, literalPrefix, reachesBelow } from "./ignored-inputs.js";
export { type ClosureUpdate, type KeyChange, KeyIndex } from "./key-index.js";
export {
  ancestorListings,
  Listings,
  listedDirectory,
  listingPath,
  ObservedSets,
  observedMetaKey,
} from "./observed.js";
export { PackageScans } from "./package-scans.js";
export { InstalledGraph, OPAQUE_BUILTINS } from "./packages.js";
export { closuresToReresolve } from "./resolution.js";
export { directoryOf, ReverseIndex, testFileId } from "./reverse-index.js";
