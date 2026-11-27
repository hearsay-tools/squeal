import { readFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { isIP, connect as netConnect, type Socket } from "node:net";
import { rootCertificates, type TLSSocket, connect as tlsConnect } from "node:tls";

/*
 * Spec 026 D7.3.1, D7.3.2 (row 026-15): how Squeal reaches Agent37, its
 * API and its SSH tunnel, from a machine that may have to use a proxy.
 * `HTTPS_PROXY` (or `https_proxy`) carries an `https:` connection through
 * HTTP `CONNECT`, unless `NO_PROXY` names the host; certificates are the
 * system's roots plus `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`. No proxy
 * credential and no API key is ever written to a log or an error, and no
 * text a server or proxy sent either: errors carry `safeReason` only.
 */

/** An error Squeal wrote itself: its message carries no remote text and no credential. */
export class LocalError extends Error {}

/**
 * A one-line reason for `error` that is safe to print: Squeal's own
 * message, else the system's error code, never the message itself. A
 * server or an injecting proxy can fill a message (a reason phrase, a
 * certificate name) with a credential this process does not know.
 */
export function safeReason(error: unknown): string {
  if (error instanceof LocalError) return error.message;
  const code = typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
  if (typeof code !== "string" || !/^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return "connection failed";
  return /CERT|SIGNATURE|ISSUER/.test(code) ? `untrusted certificate (${code})` : code;
}

/** Where a connection goes: a host and port, over TLS or not. */
export interface Endpoint {
  readonly host: string;
  readonly port: number;
  readonly tls: boolean;
}

/** The first non-empty value of `names` in `env`. */
function envValue(env: NodeJS.ProcessEnv, names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = env[name];
    if (value !== undefined && value !== "") return value;
  }
  return undefined;
}

/** True when `NO_PROXY` names `host` (on `port`): `*`, the host, or a domain it is under. */
export function bypassesProxy(host: string, port: number, env: NodeJS.ProcessEnv): boolean {
  const list = envValue(env, ["no_proxy", "NO_PROXY"]);
  if (list === undefined) return false;
  const name = host.toLowerCase().replace(/^\[|\]$/g, "");
  for (const raw of list.split(/[\s,]+/)) {
    let entry = raw.trim().toLowerCase();
    if (entry === "") continue;
    if (entry === "*") return true;
    const at = /^(.*):(\d+)$/.exec(entry);
    if (at !== null && !entry.includes("]")) {
      if (Number(at[2]) !== port) continue;
      entry = at[1] ?? "";
    }
    entry = entry.replace(/^\*?\./, "");
    if (name === entry || name.endsWith(`.${entry}`)) return true;
  }
  return false;
}

/** The proxy an `https:` connection to `host` goes through, or `null`. Throws on an unusable proxy URL. */
export function proxyFor(host: string, port: number, env: NodeJS.ProcessEnv): URL | null {
  const value = envValue(env, ["https_proxy", "HTTPS_PROXY"]);
  if (value === undefined || bypassesProxy(host, port, env)) return null;
  let proxy: URL;
  try {
    proxy = new URL(value.includes("://") ? value : `http://${value}`);
  } catch {
    // The value may carry a credential: never shown.
    throw new LocalError("HTTPS_PROXY is not a URL");
  }
  if (proxy.protocol !== "http:" && proxy.protocol !== "https:") {
    // A scheme is letters, digits and `+-.`: it cannot hold the URL's credential.
    throw new LocalError(`HTTPS_PROXY must be an http: or https: URL, not ${proxy.protocol}`);
  }
  return proxy;
}

/** The proxy as a log may show it: its host and port, never its credential. */
export function proxyName(proxy: URL): string {
  return `${proxy.hostname}:${proxyPort(proxy)}`;
}

function proxyPort(proxy: URL): number {
  return proxy.port === "" ? (proxy.protocol === "https:" ? 443 : 80) : Number(proxy.port);
}

/** The certificates a TLS connection trusts: the roots, `NODE_EXTRA_CA_CERTS` and `SSL_CERT_FILE`. */
export function trustedCa(env: NodeJS.ProcessEnv): string[] {
  const ca = [...rootCertificates];
  for (const name of ["NODE_EXTRA_CA_CERTS", "SSL_CERT_FILE"]) {
    const file = env[name];
    if (file === undefined || file === "") continue;
    try {
      ca.push(readFileSync(file, "utf8"));
    } catch {
      // As Node does for NODE_EXTRA_CA_CERTS: an unreadable file adds nothing.
    }
  }
  return ca;
}

/**
 * The API key in `env[keyEnv]`; else a placeholder when a proxy carries
 * the connection (an injecting proxy replaces it on the wire); else throws
 * naming the variable, before any connection is made.
 */
export function apiKeyFor(keyEnv: string, proxied: boolean, env: NodeJS.ProcessEnv): string {
  const key = env[keyEnv];
  if (key !== undefined && key !== "") return key;
  if (proxied) return "placeholder";
  throw new LocalError(`no Agent37 API key: set ${keyEnv}, or HTTPS_PROXY to a proxy that adds it`);
}

/**
 * Review 0.1.659-r2 B1: `signal` ends a connection being opened. Its abort
 * runs `cancel`, which destroys the operation's own request and socket;
 * the operation's own error then settles it. The returned function stops
 * listening once the operation has settled.
 */
function cancelling(signal: AbortSignal | undefined, cancel: () => void): () => void {
  if (signal === undefined) return () => {};
  signal.addEventListener("abort", cancel, { once: true });
  return () => signal.removeEventListener("abort", cancel);
}

/** The error of a connection `signal` ended. */
function stopped(what: string): LocalError {
  return new LocalError(`${what}: stopped`);
}

/** A socket to `proxy` that has answered `CONNECT` to `target` with 200. */
function connectThrough(
  proxy: URL,
  target: Endpoint,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<Socket> {
  const authority = `${target.host.includes(":") ? `[${target.host}]` : target.host}:${target.port}`;
  const headers: Record<string, string> = { Host: authority };
  if (proxy.username !== "") {
    const user = `${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`;
    headers["Proxy-Authorization"] = `Basic ${Buffer.from(user).toString("base64")}`;
  }
  const host = proxy.hostname.replace(/^\[|\]$/g, "");
  const port = proxyPort(proxy);
  let raw: Socket | undefined;
  const options = {
    host,
    port,
    method: "CONNECT",
    path: authority,
    headers,
    // Always our own socket, never an Agent: Node 26's Agent reads the process's own
    // proxy settings (NODE_USE_ENV_PROXY), which are not this call's `env`.
    createConnection: () => {
      raw =
        proxy.protocol === "https:"
          ? tlsConnect({ host, port, ca: trustedCa(env) })
          : netConnect({ host, port });
      return raw;
    },
  };
  return new Promise((resolve, reject) => {
    const asked = httpRequest(options);
    const timer = setTimeout(() => {
      asked.destroy(
        new LocalError(`proxy ${proxyName(proxy)} did not answer within ${timeoutMs} ms`),
      );
    }, timeoutMs);
    const detach = cancelling(signal, () => {
      asked.destroy(stopped(`proxy ${proxyName(proxy)}`));
      raw?.destroy();
    });
    const settle = () => {
      clearTimeout(timer);
      detach();
    };
    asked.on("error", (error) => {
      settle();
      raw?.destroy();
      reject(
        error instanceof LocalError
          ? error
          : new LocalError(`proxy ${proxyName(proxy)}: ${safeReason(error)}`),
      );
    });
    asked.on("connect", (response, socket) => {
      settle();
      if (response.statusCode !== 200) {
        socket.destroy();
        // The status as a number: the proxy's reason phrase and body stay unread.
        reject(
          new LocalError(
            `proxy ${proxyName(proxy)} refused CONNECT ${authority}: ${response.statusCode}`,
          ),
        );
        return;
      }
      resolve(socket);
    });
    if (signal?.aborted === true) asked.destroy(stopped(`proxy ${proxyName(proxy)}`));
    else asked.end();
  });
}

/** Resolves once `socket` is connected (or TLS-secured), rejecting on its first error or at `signal`. */
function ready<T extends Socket>(
  socket: T,
  event: string,
  timeoutMs: number,
  what: string,
  signal: AbortSignal | undefined,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const fail = (error: LocalError) => {
      settle();
      socket.destroy();
      reject(error);
    };
    const timer = setTimeout(() => {
      fail(new LocalError(`${what}: no connection within ${timeoutMs} ms`));
    }, timeoutMs);
    const detach = cancelling(signal, () => fail(stopped(what)));
    const settle = () => {
      clearTimeout(timer);
      detach();
    };
    socket.once("error", (error) => fail(new LocalError(`${what}: ${safeReason(error)}`)));
    socket.once(event, () => {
      settle();
      resolve(socket);
    });
    if (signal?.aborted === true) fail(stopped(what));
  });
}

/** An open connection to `target`, and whether a proxy carries it. */
export interface Opened {
  readonly socket: Socket | TLSSocket;
  readonly proxied: boolean;
}

/**
 * Opens `target`: through the proxy `proxyFor` names for a TLS endpoint,
 * else directly; TLS is verified against `trustedCa`. ALPN asks for HTTP/1.1.
 * `signal` ends the opening wherever it stands (review 0.1.659-r2 B1):
 * the proxy's `CONNECT`, the connection or the TLS handshake.
 */
export async function openEndpoint(
  target: Endpoint,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Opened> {
  const what = `${target.host}:${target.port}`;
  const proxy = target.tls ? proxyFor(target.host, target.port, env) : null;
  if (signal?.aborted === true) throw stopped(what);
  if (!target.tls) {
    const socket = netConnect({ host: target.host, port: target.port });
    return { socket: await ready(socket, "connect", timeoutMs, what, signal), proxied: false };
  }
  const tunnel =
    proxy === null ? undefined : await connectThrough(proxy, target, env, timeoutMs, signal);
  const secure = tlsConnect({
    ...(tunnel === undefined ? { host: target.host, port: target.port } : { socket: tunnel }),
    // SNI names a host, never an address.
    ...(isIP(target.host) === 0 ? { servername: target.host } : {}),
    ca: trustedCa(env),
    ALPNProtocols: ["http/1.1"],
  });
  try {
    return {
      socket: await ready(secure, "secureConnect", timeoutMs, what, signal),
      proxied: proxy !== null,
    };
  } catch (error) {
    tunnel?.destroy();
    throw error;
  }
}
