import type {
  AbsolutePath,
  PromoteRequest,
  RelativePath,
  TestFileRef,
} from "../core/types/index.js";
import { askDaemon, daemonSocket } from "./daemon-access.js";

/** How a named wait sends its promotion (`NamedWaitOptions.promote`). */
export type PromoteNamed = (
  root: AbsolutePath,
  testFiles: readonly TestFileRef[],
  withinMs: number,
) => void;

/**
 * Spec 011 C15: asks the daemon of `root` to promote `testFiles` for
 * `withinMs`, in the background. Nothing waits for the answer: an older
 * daemon answers an unknown request, and with no daemon or an error the
 * wait reads only, the order as it was. No files, no request.
 */
export const promoteNamed: PromoteNamed = (root, testFiles, withinMs) => {
  if (testFiles.length === 0) return;
  const request: PromoteRequest = {
    type: "promote",
    testFiles,
    withinMs: Math.max(0, Math.round(withinMs)),
  };
  void daemonSocket(root)
    .then((socketPath) => askDaemon(socketPath, request))
    .catch(() => null);
};

/**
 * The selected test files whose own path was named, as the worktree names
 * it: the ones a wait promotes (spec 011 C15). A source path selects the
 * files whose closure holds it, which are not promoted.
 */
export function ownPathFiles(
  selected: readonly TestFileRef[],
  named: readonly (RelativePath | null)[],
): TestFileRef[] {
  const paths = new Set(named);
  return selected.filter((file) => paths.has(file.path));
}
