import { plural } from "../text.js";
import type { ImportStatus, NodeMismatch, NodePin, SharedStatus } from "../types/status.js";

/*
 * Spec 018 D19: with `shared.ref` set, when the newest import with a test
 * file here was recorded on another Node than this worktree's daemon runs,
 * status says it once: both versions, and why the daemon does not run the
 * project's pinned Node (D18) with what to do. Imports that differ from here
 * only in Node get no line of their own (`importDefaultLines`): this line
 * counts them. Silent when the newest import's Node is the daemon's, so an
 * older import from before a Node change says nothing.
 */

/** Row 018-30's `pinnedNode(root)` in `src/core/node-pin.ts`, as status reads it. */
export type PinnedNode =
  | { readonly binary: string; readonly version: string }
  | { readonly reason: "none" | "range" | "missing" | "session"; readonly wanted?: string };

/**
 * The snapshot's `shared` part: nothing without `shared.ref`. `pin` runs
 * only when the newest import's Node differs, since it may start Node
 * binaries to read their versions.
 */
export function sharedOf(
  ref: string | null,
  imports: readonly ImportStatus[],
  pin: () => PinnedNode,
): { shared?: SharedStatus } {
  if (ref === null) return {};
  const newest = imports[0];
  if (newest?.node === undefined) return { shared: { ref } };
  const node: NodeMismatch = {
    needed: newest.node.exported,
    daemon: newest.node.here,
    pin: pinOf(pin()),
    testFiles: newest.notCurrent.environment,
    imports: imports.filter((i) => i.node?.only === true).length,
  };
  return { shared: { ref, node } };
}

function pinOf(pinned: PinnedNode): NodePin {
  if ("binary" in pinned) return { state: "pinned", wanted: pinned.version };
  return {
    state: pinned.reason,
    ...(pinned.wanted === undefined ? {} : { wanted: pinned.wanted }),
  };
}

/** The default text's line, or none; `command` names the CLI. */
export function nodeMismatchLines(shared: SharedStatus | undefined, command: string): string[] {
  const m = shared?.node;
  if (m === undefined) return [];
  const more = m.imports > 1 ? ` (${m.imports} imports differ only in Node)` : "";
  return [
    `Shared results need Node ${m.needed}; the daemon runs ${m.daemon}, so ${plural(m.testFiles, "imported test file")} cannot count here${more}. ${whyText(m, command)}.`,
  ];
}

/** Why the daemon does not run `needed`, and what to do. */
function whyText(m: NodeMismatch, command: string): string {
  const restart = `restart the daemon (\`${command} stop\`, then \`${command} start\`)`;
  const wanted = m.pin.wanted ?? "";
  switch (m.pin.state) {
    case "none":
      return `The project pins no Node version: put ${bare(m.needed)} in .node-version, then ${restart}`;
    case "range":
      return `The project's Node pin ${JSON.stringify(wanted)} is not one exact version: pin ${bare(m.needed)} in .node-version or .nvmrc, then ${restart}`;
    case "missing":
      return `The project pins Node ${bare(wanted)}, which is not installed here: install it, then ${restart}`;
    case "session":
      return `squeal.config.json sets "node": "session", so the daemon runs the session's Node: start the session on ${m.needed}, or remove that setting to use the project's pin`;
    case "pinned":
      return bare(wanted) === bare(m.daemon)
        ? `The daemon runs the project's pinned Node; CI recorded the results on another version: pin the same version in CI`
        : `The project's pinned Node ${bare(wanted)} is installed, but the daemon started on another: ${restart}`;
  }
}

/** A version without its leading `v`, as a pin file holds it. */
function bare(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}
