// Throwaway (015-76): the spawned entry point.
import { childOnly } from "./child-only.ts";
import { clamp } from "./plain.ts";

process.stdout.write(`${childOnly("ok")} ${clamp(5, { low: 0, high: 1 })}\n`);
