// Types for evals/lib/prepare.mjs's pin CLI and Codex runtime (row 006-100), imported directly rather than
// through index.mjs. Its other exports reach the tests through index.mjs.

export class MissingPinCli extends Error {
  constructor(pin: string, harness: string, why: string);
}
export interface PinRuntime {
  readonly root: string;
  readonly version: string;
}
export function pinSqueal(
  pin: string,
  harness: "claude" | "codex",
): { cli: string; runtime: PinRuntime | null };
export function retainCodexRuntime(codexHome: string, runtime: PinRuntime): string;
export const UPDATE_HOLD_MS: number;
export function holdCodexUpdates(codexHome: string, version: string, now?: number): void;
export class RuntimeMoved extends Error {
  constructor(version: string, why: string);
}
export function checkCodexRuntime(codexHome: string, version: string): void;
