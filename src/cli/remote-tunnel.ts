import type { Readable, Writable } from "node:stream";
import {
  runTunnel,
  TUNNEL_FAILED,
  TUNNEL_HOST_TEMPLATE,
  tunnelHost,
  validInstanceId,
} from "../core/runner-host/remote/providers/agent37/tunnel.js";
import type { CliIo } from "./main.js";

/*
 * `squeal remote-tunnel agent37 <instance-id>` (spec 026 D12.6, row
 * 026-15), hidden: the `ProxyCommand` an Agent37 machine's SSH runs. It
 * takes the name of the variable holding the API key, never the key: an
 * argument shows in `ps` and in the daemon's log. Exit code 0 when the
 * stream ended, 2 on a usage error, 255 when the tunnel did not open.
 */

const USAGE =
  "usage: squeal remote-tunnel agent37 <instance-id> [--api-key-env <NAME>] [--host <host>] [--port <port>]\n";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface TunnelStdio {
  readonly stdin: Readable;
  readonly stdout: Writable;
  readonly env: NodeJS.ProcessEnv;
}

interface Parsed {
  readonly id: string;
  readonly keyEnv: string;
  readonly host: string;
  readonly port: number;
}

/** The arguments, or `null` on a usage error. No argument's value is ever echoed: one may be a key typed by mistake. */
function parse(args: readonly string[]): Parsed | null {
  const [provider, id, ...flags] = args;
  if (provider !== "agent37" || !validInstanceId(id)) return null;
  let keyEnv = "AGENT37_API_KEY";
  let host = tunnelHost(TUNNEL_HOST_TEMPLATE, id);
  let port = 443;
  for (let i = 0; i < flags.length; i += 2) {
    const value = flags[i + 1];
    if (value === undefined) return null;
    switch (flags[i]) {
      case "--api-key-env":
        if (!ENV_NAME.test(value)) return null;
        keyEnv = value;
        break;
      case "--host":
        if (!/^[A-Za-z0-9.-]+$/.test(value)) return null;
        host = value;
        break;
      case "--port":
        port = Number(value);
        if (!Number.isInteger(port) || port < 1 || port > 65_535) return null;
        break;
      default:
        return null;
    }
  }
  return { id, keyEnv, host, port };
}

export async function remoteTunnelCommand(
  args: readonly string[],
  io: CliIo,
  stdio: TunnelStdio = { stdin: process.stdin, stdout: process.stdout, env: process.env },
): Promise<number> {
  const parsed = parse(args);
  if (parsed === null) {
    io.stderr(USAGE);
    return 2;
  }
  const code = await runTunnel({
    host: parsed.host,
    port: parsed.port,
    keyEnv: parsed.keyEnv,
    env: stdio.env,
    input: stdio.stdin,
    output: stdio.stdout,
    fail: (message) => io.stderr(`squeal remote-tunnel: ${message}\n`),
  });
  return code === 0 ? 0 : TUNNEL_FAILED;
}
