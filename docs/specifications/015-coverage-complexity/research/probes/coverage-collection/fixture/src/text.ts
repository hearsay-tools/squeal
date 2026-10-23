import { clamp } from "./math.js";

export function pad(text: string, width: number): string {
  const size = clamp(width, 0, 80);
  return text.padEnd(size, " ");
}

export function unused(): string {
  return "never called";
}
