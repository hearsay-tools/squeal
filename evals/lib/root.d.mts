// Types for evals/lib/root.mjs, imported directly rather than through index.mjs.

export const REPO_MARKERS: readonly string[];
export function evalsRoot(env?: NodeJS.ProcessEnv): string;
export function repoAncestor(dir: string): { dir: string; marker: string } | null;
export function refuseInsideRepo(dir: string, options?: { force?: boolean }): string;
