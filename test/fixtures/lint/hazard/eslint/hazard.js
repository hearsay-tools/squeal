// Spec 017 goal 6: a plugin that misbehaves when the linted text names a hazard.
const act = {
  meta: { type: "problem", schema: [] },
  create(context) {
    const text = context.sourceCode.text;
    if (text.includes("HAZARD_BLOCK")) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20_000);
    if (text.includes("HAZARD_TIMER")) setTimeout(() => { throw new Error("the plugin's timer threw"); }, 0);
    if (text.includes("HAZARD_LATE")) setTimeout(() => { throw new Error("the plugin's late timer threw"); }, 200);
    if (text.includes("HAZARD_EXIT")) process.exit(3);
    if (text.includes("HAZARD_THROW")) throw new Error("the plugin's rule threw");
    return {};
  },
};

export default { rules: { act } };
