// Throwaway: prints each variant's frame under Node's own type stripping.
for (const v of ["a", "b", "c", "d"]) console.log(v, (await import(`./${v}.ts`)).where({}));
