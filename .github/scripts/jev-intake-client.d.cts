// Types for jev-intake-client.cjs, so the Vitest suite can import it.

import type { JevRequest, JevResponse } from "./jev-issue-intake.cjs";

type Fetch = (url: string, init: RequestInit) => Promise<unknown>;
export interface Transport {
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

export function callJev(
  input: { request: JevRequest; apiKey: string | undefined } & Transport,
): Promise<JevResponse>;
export function truncate(text: unknown, limit: number): string;
export const ENDPOINT: string;
