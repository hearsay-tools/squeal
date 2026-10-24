const m = await importOriginal<typeof import("./x.js")>();
// ---
vi.importActual<typeof import("./x.js")>("./x.js");
// ---
f<typeof import("./x.js").Y>();
// ---
f<Awaited<typeof import("./x.js")>>();
// ---
f<typeof import("./x.js"), string>();
// ---
new Foo<typeof import("./x.js")>();
// ---
f<{ a: typeof import("./x.js") }>();
// ---
f<import("./x.js").T>();
// ---
f<typeof X>();
// ---
f<typeof a.b>();
// ---
type T = typeof import("./x.js");
// ---
let a: typeof import("./x.js");
// ---
type U = Foo<typeof import("./x.js")>;
// ---
const y = z as typeof import("./x.js");
// ---
const w = z satisfies typeof import("./x.js");
// ---
function g(p: Partial<typeof import("./x.js")>) {}
// ---
const h = React.createRef<import('./composer').ComposerHandle>()
// ---
const m = await importOriginal<typeof _mport("./x.js")>();
// ---
const m = await importOriginal<typeof ________________>();
// ---
const h = React.createRef<____________________.ComposerHandle>()
// ---
f<keyof  import("./x.js")>();
// ---
f<typeof import ("./x.js")>();
// ---
f<keyof typeof import("./x.js")>();
