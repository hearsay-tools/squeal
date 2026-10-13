import { createInterface } from "node:readline";

/*
 * Spec 005 D3 step 3: the terminal `squeal setup` asks on. Questions go
 * through `node:readline`, and only when both ends are terminals: under a
 * pipe, stdin is the script (`research/wave-0-checks.md` 4).
 */

/** Asks one question, resolving with the answer line; end of input answers the empty line. */
export type Ask = (question: string) => Promise<string>;

export interface Terminal {
  readonly input: NodeJS.ReadableStream & { readonly isTTY?: boolean };
  readonly output: NodeJS.WritableStream & { readonly isTTY?: boolean };
}

export interface Asker {
  readonly ask: Ask;
  readonly close: () => void;
}

/**
 * One readline over the terminal for every question, so lines typed ahead
 * answer the next questions in order; `null` when either end is not a TTY.
 */
export function terminalAsker(
  terminal: Terminal = { input: process.stdin, output: process.stdout },
): Asker | null {
  if (terminal.input.isTTY !== true || terminal.output.isTTY !== true) return null;
  const rl = createInterface({ input: terminal.input, output: terminal.output, terminal: false });
  const lines = rl[Symbol.asyncIterator]();
  let ended = false;
  return {
    ask: async (question) => {
      terminal.output.write(question);
      if (ended) return "";
      const next = await lines.next();
      if (next.done === true) {
        ended = true;
        return "";
      }
      return next.value;
    },
    close: () => rl.close(),
  };
}
