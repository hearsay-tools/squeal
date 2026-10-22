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
export { formerReadAsOne } from "./former.js";
export { createInputMatcher, globToRegExp } from "./glob.js";
export { KEY_FORMAT_VERSION, KEY_FORMATS_READ_AS_ONE } from "./key-format.js";
export {
  type ClosureUpdate,
  type KeyChange,
  KeyIndex,
  type KeysReadAsOne,
  type ReadAsOne,
} from "./key-index.js";
export {
  ancestorListings,
  GIT_ENTRY,
  gitEntryByKind,
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
