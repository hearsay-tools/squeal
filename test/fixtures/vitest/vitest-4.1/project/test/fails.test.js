export default {
  fails: () => {
    throw new Error("expected 1 to be 2");
  },
};
