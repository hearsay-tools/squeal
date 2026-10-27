import { RuntimeReleaseError } from "./errors.js";

/*
 * Row 002-30 (spec 002 D8): one bounded GET. The transport is injected so
 * tests never reach a real endpoint; the default is Node's `fetch` with no
 * credentials (no token is read from the environment). Whatever the
 * transport does, this module bounds it: the operation's signal ends a
 * request or a body that stalls, and a body over its byte bound is refused
 * as soon as it crosses it. One attempt only; retry delays belong to the
 * updater.
 */

export interface ReleaseResponse {
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  readonly body: AsyncIterable<Uint8Array> | null;
}

export interface ReleaseRequest {
  readonly headers: Readonly<Record<string, string>>;
  readonly signal: AbortSignal;
}

/** Performs one GET of `url`; redirects are the transport's to follow. */
export type ReleaseTransport = (url: string, request: ReleaseRequest) => Promise<ReleaseResponse>;

/** Node's `fetch`, following redirects (release downloads redirect to GitHub's asset host). */
export const fetchTransport: ReleaseTransport = async (url, request) => {
  const response = await fetch(url, {
    headers: request.headers,
    signal: request.signal,
    redirect: "follow",
  });
  return { status: response.status, headers: response.headers, body: response.body };
};

/** The operation's signals: `deadline` names a timeout, `caller` an abort. */
export interface Deadline {
  readonly signal: AbortSignal;
  readonly deadline: AbortSignal;
  readonly caller: AbortSignal | undefined;
}

export function deadlineOf(timeoutMs: number, caller?: AbortSignal): Deadline {
  const deadline = AbortSignal.timeout(timeoutMs);
  const signal = caller === undefined ? deadline : AbortSignal.any([deadline, caller]);
  return { signal, deadline, caller };
}

/** `promise`, or the signal's reason as soon as it aborts. */
function race<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function failed(error: unknown, url: string, time: Deadline): RuntimeReleaseError {
  if (error instanceof RuntimeReleaseError) return error;
  if (time.deadline.aborted) return new RuntimeReleaseError("timeout", `GET ${url} timed out`);
  if (time.caller?.aborted) return new RuntimeReleaseError("aborted", `GET ${url} was aborted`);
  const cause = (error as { cause?: { code?: unknown } }).cause?.code;
  const detail = `${(error as Error).message}${typeof cause === "string" ? ` (${cause})` : ""}`;
  return new RuntimeReleaseError("network", `GET ${url} failed: ${detail}`);
}

/** Ends an abandoned body without waiting for it. */
function abandon(iterator: AsyncIterator<Uint8Array>): void {
  iterator.return?.().catch(() => undefined);
}

/**
 * GETs `url` and returns its whole body, at most `maxBytes`. Throws a
 * `RuntimeReleaseError`: `http` for a non-2xx status, `too-large` past the
 * bound (by `content-length` before reading, or while reading), `timeout`
 * or `aborted` when the operation's signal ends it, `network` otherwise.
 */
export async function getBounded(
  transport: ReleaseTransport,
  url: string,
  options: { headers: Readonly<Record<string, string>>; maxBytes: number; time: Deadline },
): Promise<Buffer> {
  const { time, maxBytes } = options;
  let iterator: AsyncIterator<Uint8Array> | undefined;
  try {
    const response = await race(
      transport(url, { headers: options.headers, signal: time.signal }),
      time.signal,
    );
    iterator = response.body?.[Symbol.asyncIterator]();
    if (response.status < 200 || response.status > 299)
      throw new RuntimeReleaseError(
        "http",
        `GET ${url} answered ${response.status}`,
        response.status,
      );
    const length = Number(response.headers.get("content-length") ?? Number.NaN);
    if (length > maxBytes)
      throw new RuntimeReleaseError("too-large", `GET ${url} is ${length} bytes, over ${maxBytes}`);
    const chunks: Buffer[] = [];
    let total = 0;
    while (iterator !== undefined) {
      const next = await race(iterator.next(), time.signal);
      if (next.done === true) break;
      total += next.value.byteLength;
      if (total > maxBytes)
        throw new RuntimeReleaseError("too-large", `GET ${url} sent over ${maxBytes} bytes`);
      chunks.push(Buffer.from(next.value));
    }
    iterator = undefined;
    return Buffer.concat(chunks);
  } catch (error) {
    if (iterator !== undefined) abandon(iterator);
    throw failed(error, url, time);
  }
}
