// Task 001-424: a local environment that runs test files through Vite's
// `client` environment, as jsdom, happy-dom and browser mode do, with no
// dependency. Vite raises "Failed to resolve import" there, not in `ssr`.
export default {
  name: "client-env",
  viteEnvironment: "client",
  setup() {
    return { teardown() {} };
  },
};
