import type { RemoteMachineProvider } from "../provider.js";
import { agent37Provider } from "./agent37/index.js";
import { commandProvider } from "./command.js";
import { sshProvider } from "./ssh.js";

/*
 * Spec 026 D6.3 (row 026-10): the providers by `provider` kind. A new
 * provider is one module under `providers/` and one line here; the lane,
 * the connect and the scheduler never name a vendor.
 */

const PROVIDERS: Readonly<Record<string, RemoteMachineProvider>> = {
  ssh: sshProvider,
  command: commandProvider,
  // Spec 026 D7.3 (row 026-15).
  agent37: agent37Provider,
};

/** The provider of `kind`, or `null` when none is built in. */
export function providerOf(kind: string): RemoteMachineProvider | null {
  return Object.hasOwn(PROVIDERS, kind) ? (PROVIDERS[kind] ?? null) : null;
}

/** The built-in kinds, for a problem's text. */
export const PROVIDER_KINDS: readonly string[] = Object.keys(PROVIDERS);
