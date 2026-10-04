/**
 * True for errors meaning "no such file": the path or a parent is gone
 * (`ENOENT`), a parent is a file (`ENOTDIR`), or a file read hit a directory
 * (`EISDIR`). `lstat` and `readdir` never give `EISDIR`, so their callers see
 * the same result with or without it.
 */
export function isMissing(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR" || code === "EISDIR";
}
