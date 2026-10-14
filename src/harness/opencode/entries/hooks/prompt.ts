import { prompt, runEntry } from "../../bridge.js";

// The `prompt` bridge entry (spec 008 D4), bundled as `dist/hooks/prompt.mjs`.
await runEntry(import.meta.url, "prompt", prompt);
