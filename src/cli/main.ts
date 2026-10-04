import { readFileSync } from "node:fs";

const HELP = `squeal: continuous validation for coding agents. Push transitions, pull state.

Usage:
  squeal --version   Print the version
  squeal --help      Print this help

Commands from spec 001 (status, why, run, daemon, start, init) are not implemented yet.
`;

/** Reads `version` from the package manifest two levels up from `src/cli` or `dist/cli`. */
function readVersion(): string {
  const manifest = new URL("../../package.json", import.meta.url);
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  if (typeof parsed === "object" && parsed !== null && "version" in parsed) {
    return String(parsed.version);
  }
  throw new Error(`squeal: no version in ${manifest.pathname}`);
}

export interface CliIo {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

/** Runs the CLI and returns the exit code. */
export function main(argv: readonly string[], io: CliIo): number {
  const [first] = argv;
  if (first === "--version" || first === "-v") {
    io.stdout(`${readVersion()}\n`);
    return 0;
  }
  if (first === undefined || first === "--help" || first === "-h" || first === "help") {
    io.stdout(HELP);
    return 0;
  }
  io.stderr(`squeal: unknown command "${first}"\n\n${HELP}`);
  return 2;
}
