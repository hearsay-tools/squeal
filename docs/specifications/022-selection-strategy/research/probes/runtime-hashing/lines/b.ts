// A module whose stack positions must stay put; this comment is longer than the first.
import type { Other } from "./other";
interface Shape { b: string; c: boolean[] }
export function where(x: Shape): string /* returns our frame */ {
  const s = new Error().stack as string;
  return s.split("\n")[1].replace(/.*[/\\]/, "").replace(/\)$/, "");
}
