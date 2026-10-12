/** Error codes a watch gets when the system refuses another one. */
const LIMIT_CODES = new Set(["ENOSPC", "EMFILE"]);

/**
 * True when `error` is the system refusing a watch: ENOSPC, out of inotify
 * watches, or EMFILE, out of descriptors. chokidar reports one such error per
 * path it cannot watch (task 001-299).
 */
export function isWatchLimit(error: Error): boolean {
  return LIMIT_CODES.has(String((error as NodeJS.ErrnoException).code));
}

/** The one note a feed gives for every watch the system refused. */
export function watchLimitNote(error: Error): Error {
  const code = (error as NodeJS.ErrnoException).code;
  return new Error(
    `squeal: the system refused a file watch (${code}); raise fs.inotify.max_user_watches` +
      " (ENOSPC) or the open-file limit (EMFILE). Until the daemon restarts, changes to the" +
      " paths it could not watch are found by the 30 s pass only.",
  );
}
