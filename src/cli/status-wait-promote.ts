import type {
  AbsolutePath,
  FocusRequest,
  PromoteRequest,
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
 * How the daemon took a focus request: `accepted`; `refused`, a daemon that
 * does not know it (an older one) or cannot focus; `none`, no daemon or no
 * answer, so the wait cannot tell.
 */
export type FocusReply = "accepted" | "refused" | "none";

/** How a named wait with `--check` sends its focus (`NamedWaitOptions.focus`). */
export type FocusNamed = (
  root: AbsolutePath,
  testFiles: readonly TestFileRef[],
  texts: readonly string[],
  withinMs: number,
) => Promise<FocusReply>;

/**
 * Row 011-146 (011 C15 as amended 2026-10-23): asks the daemon of `root` to
 * run first, alone, the checks of `testFiles` whose full name holds one of
 * `texts`, for `withinMs`. Sent once, beside the promotion. The answer only
 * says whether the daemon knows the request: an older daemon answers it
 * unknown, and the wait reads as a named wait. No files or texts, no request.
 */
export const focusNamed: FocusNamed = async (root, testFiles, texts, withinMs) => {
  if (testFiles.length === 0 || texts.length === 0) return "none";
  const request: FocusRequest = {
    type: "focus",
    testFiles,
    texts,
    withinMs: Math.max(0, Math.round(withinMs)),
  };
  try {
    const answer = await askDaemon(await daemonSocket(root), request);
    if (answer === null) return "none";
    if (answer.ok) return "accepted";
    const unknown = answer.error.startsWith("unknown request type");
    return unknown || answer.error === "this daemon cannot focus" ? "refused" : "none";
  } catch {
    return "none";
  }
};
