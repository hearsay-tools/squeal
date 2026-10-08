import { marker } from "./lib/marker.mjs";

globalThis.fixturePreload = marker();
process.env.FIXTURE_PRELOAD = marker();
