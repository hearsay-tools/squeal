import { marker } from "../src/only-setup.ts";

(globalThis as { marker?: string }).marker = marker;
