import { runEntry } from "../../bridge.js";
import { wait } from "../../bridge-turn.js";

// The `wait` bridge entry (spec 008 D4), bundled as `dist/hooks/wait.mjs`.
await runEntry(import.meta.url, "wait", wait);
