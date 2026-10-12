import { stopSlow } from "../hooks/stop-slow.js";
import { runMain } from "../main.js";

await runMain("stop-slow", stopSlow);
