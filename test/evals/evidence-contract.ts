// 006-17 against 006-16's contract before 006-16 lands (tasks/wave-2.6.md): each classified test
// action carries `runner`, `informational` and `scope` (`{ full: true }` or `{ full: false,
// paths, names }`). Where `classifyShell` does not yet set them, this fills them for the one
// simple command a reference session runs. Once 006-16 has landed the real fields win, and this
// file and its `vi.mock` lines can go.

type Action = { kind: string; [key: string]: unknown };
type Classify = (text: string, opts?: object) => Action[];

const VALUE_FLAGS = new Set(["--reporter", "--config", "-c", "--project", "--root", "--dir"]);

function contractOf(kind: string, text: string) {
  const words = text.replace(/['"]/g, "").trim().split(/\s+/);
  const informational = words.some((w) =>
    ["--help", "-h", "--version", "-v", "list", "--list", "watch", "--watch"].includes(w),
  );
  if (kind === "node:test") {
    if (words[0] === "npm")
      return { informational, scope: { full: false, paths: ["scripts/*.test.mjs"] } };
    const paths = words.slice(words.indexOf("--test") + 1).filter((w) => !w.startsWith("-"));
    return { informational, scope: paths.length ? { full: false, paths } : { full: true } };
  }
  const at = words.findIndex((w) => /vitest$/.test(w));
  const paths: string[] = [];
  const names: string[] = [];
  const args = words.slice(at + 1);
  for (let i = 0; i < args.length; i++) {
    const a = args[i] as string;
    if (a === "-t" || a === "--testNamePattern") names.push(args[++i] as string);
    else if (VALUE_FLAGS.has(a)) i++;
    else if (!a.startsWith("-") && a !== "run") paths.push(a);
  }
  const scope = paths.length || names.length ? { full: false, paths, names } : { full: true };
  return { informational, scope };
}

/** The `vi.mock` factory body: `classifyShell` with the contract's fields filled in. */
export function withContract<M extends { classifyShell: Classify }>(actual: M): M {
  return {
    ...actual,
    classifyShell: (text: string, opts?: object) =>
      actual
        .classifyShell(text, opts)
        .map((a) =>
          (a.kind === "vitest" || a.kind === "node:test") && typeof a.scope !== "object"
            ? { ...a, runner: a.kind, ...contractOf(a.kind, text) }
            : a,
        ),
  };
}
