// A module whose stack positions must not move under type and comment edits.
import type { Thing } from "./thing";
interface Shape {
  a: number }
export function where(x: Shape): string /* returns the frame */ {
  const s = new Error().stack as string;
  return s.split("\n")[1].replace(/.*[/\\]/, "").replace(/\)$/, "");
}
