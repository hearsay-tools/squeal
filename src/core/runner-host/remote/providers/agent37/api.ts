import { request as httpRequest } from "node:http";
import { isRecord } from "../../../../fs/json.js";
import { apiKeyFor, LocalError, openEndpoint, proxyFor, safeReason } from "./net.js";

/*
 * Spec 026 D7.3.3, D7.3.4 (row 026-15): the Agent37 control plane, as its
 * docs give it (fetched 2026-11-24): `Authorization: Bearer <key>` on
 * `https://api.agent37.com`; `POST /v1/instances` answers once the
 * instance is `running`; `/sleep` keeps memory and bills disk only;
 * `/start` wakes a sleeping or stopped instance (`202` while it moves
 * host); `DELETE` acts once, then `404`; `409 try_again` means retry in a
 * few seconds. Through `HTTPS_PROXY` like the tunnel, with no dependency.
 * The key never reaches an error or a log, and no text the API or a proxy
 * sent does either: an error names the status and an allowlisted code.
 */

/** An instance as the API names it; other fields are not read. */
export interface Instance {
  readonly id: string;
  readonly status: string;
}

/** What `POST /v1/instances` is sent. */
export interface CreateBody {
  readonly template: string;
  readonly region: string;
  readonly type: string;
  readonly resources: { readonly cpu: number; readonly memory: number; readonly disk: number };
  readonly auto_sleep: boolean;
  readonly idle_timeout_seconds: number;
  readonly name: string;
}

export interface ApiOptions {
  readonly baseUrl: string;
  readonly keyEnv: string;
  readonly env: NodeJS.ProcessEnv;
  /** Waits between `409 try_again` retries, and how many. Default 2 s, 20 times. */
  readonly retryMs?: number;
  readonly retries?: number;
}

/**
 * The error codes an `Agent37Error` may carry. Any other code is dropped:
 * a server, or a proxy that injects the key, could reflect a credential in
 * it, and this process does not know every credential it could reflect.
 */
const KNOWN_CODES: ReadonlySet<string> = new Set([
  "bad_request",
  "conflict",
  "forbidden",
  "insufficient_balance",
  "internal_error",
  "invalid_request",
  "method_not_allowed",
  "not_found",
  "quota_exceeded",
  "rate_limited",
  "service_unavailable",
  "try_again",
  "unauthorized",
]);

/** A call the API refused, with its status and its error code when the code is a known one. */
export class Agent37Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
  }
}

interface Answer {
  readonly status: number;
  readonly body: unknown;
}

const CALL_MS = 60_000;
/** A create returns once the VM booted. */
const CREATE_MS = 300_000;

export class Agent37Api {
  readonly #options: ApiOptions;
  readonly #base: URL;

  constructor(options: ApiOptions) {
    this.#options = options;
    this.#base = new URL(options.baseUrl);
  }

  /** The instance, or `null` when Agent37 no longer has it (`404`). */
  async inspect(id: string, signal?: AbortSignal): Promise<Instance | null> {
    const answer = await this.#call("GET", `/v1/instances/${id}`, undefined, CALL_MS, signal);
    if (answer.status === 404) return null;
    return this.#instance("GET", `/v1/instances/${id}`, answer);
  }

  async create(body: CreateBody): Promise<Instance> {
    const path = "/v1/instances";
    return this.#instance("POST", path, await this.#call("POST", path, body, CREATE_MS));
  }

  /** Puts a running instance to sleep; returns once it sleeps. */
  async sleep(id: string): Promise<void> {
    const path = `/v1/instances/${id}/sleep`;
    this.#ok("POST", path, await this.#retrying("POST", path));
  }

  /** Wakes a sleeping instance or starts a stopped one; `starting` when it is still moving host. */
  async start(id: string): Promise<Instance> {
    const path = `/v1/instances/${id}/start`;
    return this.#instance("POST", path, await this.#retrying("POST", path));
  }

  /** Deletes the instance; false when it was already gone (`404`). */
  async remove(id: string): Promise<boolean> {
    const path = `/v1/instances/${id}`;
    const answer = await this.#call("DELETE", path);
    if (answer.status === 404) return false;
    this.#ok("DELETE", path, answer);
    return true;
  }

  async #retrying(method: string, path: string): Promise<Answer> {
    const retries = this.#options.retries ?? 20;
    for (let attempt = 0; ; attempt++) {
      const answer = await this.#call(method, path);
      if (answer.status !== 409 || errorCode(answer.body) !== "try_again" || attempt >= retries) {
        return answer;
      }
      await new Promise((resolve) => setTimeout(resolve, this.#options.retryMs ?? 2_000));
    }
  }

  #ok(method: string, path: string, answer: Answer): void {
    if (answer.status >= 200 && answer.status < 300) return;
    // Never `error.message`: only the status and a code from KNOWN_CODES.
    const code = errorCode(answer.body);
    throw new Agent37Error(
      `Agent37 ${method} ${path} answered ${answer.status}${code === null ? "" : ` (${code})`}`,
      answer.status,
      code,
    );
  }

  #instance(method: string, path: string, answer: Answer): Instance {
    this.#ok(method, path, answer);
    const { body } = answer;
    if (isRecord(body) && typeof body.id === "string" && typeof body.status === "string") {
      return { id: body.id, status: body.status };
    }
    throw new Error(`Agent37 ${method} ${path} answered no instance id and status`);
  }

  /** Row 026-20: `signal` ends the call where it stands; never given to a create (index.ts). */
  async #call(
    method: string,
    path: string,
    body?: unknown,
    timeoutMs = CALL_MS,
    signal?: AbortSignal,
  ): Promise<Answer> {
    signal?.throwIfAborted();
    const base = this.#base;
    const tls = base.protocol === "https:";
    const port = base.port === "" ? (tls ? 443 : 80) : Number(base.port);
    const host = base.hostname.replace(/^\[|\]$/g, "");
    const { env, keyEnv } = this.#options;
    const key = apiKeyFor(keyEnv, tls && proxyFor(host, port, env) !== null, env);
    const opened = await openEndpoint({ host, port, tls }, env, timeoutMs);
    if (signal?.aborted === true) {
      opened.socket.destroy();
      signal.throwIfAborted();
    }
    const payload = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    const prefix = base.pathname.replace(/\/+$/, "");
    return new Promise((resolve, reject) => {
      const asked = httpRequest({
        method,
        host,
        port,
        path: `${prefix}${path}`,
        // The socket opened above, never an Agent: `agent: false` makes a fresh Agent that
        // ignores `createConnection` and reads the process's own proxy settings.
        createConnection: () => opened.socket,
        headers: {
          Host: base.host,
          Authorization: `Bearer ${key}`,
          Accept: "application/json",
          ...(payload === undefined
            ? {}
            : { "Content-Type": "application/json", "Content-Length": String(payload.length) }),
        },
      });
      const timer = setTimeout(() => {
        asked.destroy(new LocalError(`no answer within ${timeoutMs} ms`));
      }, timeoutMs);
      const onAbort = () => asked.destroy(new LocalError("stopped: the daemon's exit began"));
      signal?.addEventListener("abort", onAbort, { once: true });
      asked.on("close", () => signal?.removeEventListener("abort", onAbort));
      asked.on("error", (error) => {
        clearTimeout(timer);
        reject(new Error(`Agent37 ${method} ${path}: ${safeReason(error)}`));
      });
      asked.on("response", (response) => {
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => chunks.push(chunk));
        response.on("error", (error) => {
          clearTimeout(timer);
          reject(new Error(`Agent37 ${method} ${path}: ${safeReason(error)}`));
        });
        response.on("end", () => {
          clearTimeout(timer);
          opened.socket.destroy();
          const text = Buffer.concat(chunks).toString("utf8");
          let parsed: unknown = null;
          try {
            parsed = text === "" ? null : JSON.parse(text);
          } catch {
            parsed = null;
          }
          resolve({ status: response.statusCode ?? 0, body: parsed });
        });
      });
      asked.end(payload);
    });
  }
}

/** The answer's `error.code` when KNOWN_CODES has it, else `null`. */
function errorCode(body: unknown): string | null {
  const code = isRecord(body) && isRecord(body.error) ? body.error.code : undefined;
  return typeof code === "string" && KNOWN_CODES.has(code) ? code : null;
}
