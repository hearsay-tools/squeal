import { existsSync } from "node:fs";
import { join } from "node:path";
import { changedAfter, registration } from "../../core/delivery/registered.js";
import type { HookContext } from "./context.js";

/** Code files a test could read; docs, config and data edits never get the line. */
const CODE = /\.(?:[cm]?[jt]sx?|py)$/;

/**
 * Experiment C1 (research/uncovered-trust.md): once per path per consumer, the
 * code files changed since registration that no test Squeal runs reads, by
 * every test file's recorded closure. Experiment only: the told set is a meta
 * row, and closures are `complete: false`, so the text says what Squeal runs.
 */
export function uncoveredEditLine(context: HookContext): string | null {
  const { store, consumer } = context;
  const r = registration(store, consumer);
  const latest = store.revisions.latest(consumer.worktreeId);
  if (r === null || latest === null) return null;
  const { changed } = changedAfter(store, consumer.worktreeId, r, latest.number);
  const read = new Set<string>();
  for (const file of store.testFiles.list()) {
    read.add(file.testFile.path);
    for (const path of file.closure.paths) read.add(path);
  }
  const key = `exp-uncovered.${consumer.worktreeId}.${consumer.sessionId}.${consumer.agentId}`;
  const told = new Set<string>(JSON.parse(store.meta.get(key) ?? "[]") as string[]);
  const fresh = [...changed].filter(
    (p) =>
      CODE.test(p) &&
      !p.startsWith("dist/") &&
      !p.includes("/dist/") &&
      !read.has(p) &&
      !told.has(p) &&
      existsSync(join(context.root, p)),
  );
  if (fresh.length === 0) return null;
  store.meta.set(key, JSON.stringify([...told, ...fresh]));
  const shown = fresh.slice(0, 3).join(", ");
  const more = fresh.length > 3 ? ` and ${fresh.length - 3} more` : "";
  const one = fresh.length === 1;
  return `No result for ${shown}${more}: no test Squeal runs reads ${one ? "it" : "them"}. Run whatever tests ${one ? "it" : "them"} yourself.`;
}
