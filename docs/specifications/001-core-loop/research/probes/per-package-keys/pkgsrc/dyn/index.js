export const dyn = async () => { const n = ["computed", "target"].join("-"); return (await import(n)).c(); };
