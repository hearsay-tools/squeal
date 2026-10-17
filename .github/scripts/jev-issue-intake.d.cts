// Types for jev-issue-intake.cjs, so the Vitest suite can import it.

import type { Intake } from "./apply-issue-intake.cjs";
import type { Candidate } from "./issue-intake-candidates.cjs";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  criteria: Record<string, unknown>;
}
export interface NoulQuestion {
  type: "noul";
  instructions: unknown;
}
export interface JevRequest {
  model: string;
  state: { title: string; body: string };
  questions: Record<string, ChoiceQuestion | NoulQuestion>;
}
export type JevAnswer =
  | { type: "choice"; choice: string; probabilities: Record<string, number>; confidence?: number }
  | { type: "noul"; noul: number };
export interface JevResponse {
  model?: string;
  usage?: { input_tokens?: number };
  answers: Record<string, JevAnswer | undefined>;
}
export interface Thresholds {
  shortlist: number;
  duplicate: number;
  sameWork: number;
  mainArea: number;
  type: number;
}
export interface IssueText {
  title?: string | null;
  body?: string | null;
}
type Fetch = (url: string, init: RequestInit) => Promise<unknown>;
interface Transport {
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  timeoutMs?: number;
}

export function buildRequest(input: {
  issue: IssueText;
  candidates: Candidate[];
  model?: string;
}): JevRequest;
export function buildRecheckRequest(input: {
  issue: IssueText;
  candidates: Candidate[];
  numbers: number[];
  model?: string;
}): JevRequest;
export function shortlist(input: {
  response: unknown;
  thresholds?: Thresholds;
  size?: number;
}): number[];
export function mapAnswers(input: {
  request: JevRequest;
  response: unknown;
  recheck?: { request: JevRequest; response: unknown } | null;
  thresholds?: Thresholds;
}): Intake;
export function callJev(
  input: { request: JevRequest; apiKey: string | undefined } & Transport,
): Promise<JevResponse>;
export function triage(
  input: {
    issue: IssueText;
    candidates: Candidate[];
    model?: string;
    apiKey: string | undefined;
    thresholds?: Thresholds;
  } & Transport,
): Promise<{ intake: Intake; log: string }>;
export function excerptOf(body: unknown, limit: number): string;
export function main(
  argv: string[],
  env?: Record<string, string | undefined>,
  transport?: Transport,
): Promise<void>;
export const AREA_CRITERIA: Readonly<Record<string, string>>;
export const TYPE_CRITERIA: Readonly<Record<string, string>>;
export const THRESHOLDS: Readonly<Thresholds>;
export const DEFAULT_MODEL: string;
export const ENDPOINT: string;
