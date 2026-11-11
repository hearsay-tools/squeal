import { Session } from "node:inspector";
export function hasSession(): boolean {
  return typeof Session === "function";
}
