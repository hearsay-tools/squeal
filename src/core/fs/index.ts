export { compare } from "./compare.js";
export { isMissing } from "./errors.js";
export { type RunGitOptions, runGit, splitNul } from "./git.js";
export {
  findWorktreeRoot,
  gitDirOf,
  hasGitEntry,
  linkedWorktreeDir,
  lstatOrNull,
  resolveCommonDir,
  worktreeIdFor,
} from "./git-layout.js";
export { toAbsolute, toRelative } from "./paths.js";
