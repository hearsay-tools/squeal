import { readFileSync } from "node:fs";

export default {
  reads: () => {
    if (readFileSync(new URL("../data/a.txt", import.meta.url), "utf8") !== "a\n") {
      throw new Error("data/a.txt changed");
    }
  },
  waits: "skip",
};
