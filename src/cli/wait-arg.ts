/**
 * Takes `--wait <ms>` or `--wait=<ms>` out of `args`. `waitMs` is `null`
 * without the flag; a string is the usage error when its value is not a
 * whole number of milliseconds.
 */
export function takeWait(
  args: readonly string[],
): { readonly waitMs: number | null; readonly rest: readonly string[] } | string {
  const waitAt = args.findIndex((a) => a === "--wait" || a.startsWith("--wait="));
  if (waitAt === -1) return { waitMs: null, rest: args };
  const arg = args[waitAt] as string;
  const inline = arg.startsWith("--wait=");
  const value = inline ? arg.slice("--wait=".length) : args[waitAt + 1];
  if (value === undefined || !/^\d+$/.test(value)) {
    return "--wait takes a whole number of milliseconds";
  }
  return {
    waitMs: Number(value),
    rest: args.filter((_, i) => i !== waitAt && (inline || i !== waitAt + 1)),
  };
}
