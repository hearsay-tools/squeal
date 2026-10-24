/* An LD_PRELOAD read tracer, as libc interposition tracers work: logs every
   open/openat path to stderr, then calls the real libc function. */
#define _GNU_SOURCE
#include <dlfcn.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
static void note(const char *p) { fprintf(stderr, "[shim] open %s\n", p); }
int open(const char *p, int flags, ...) {
  va_list a; va_start(a, flags); int mode = va_arg(a, int); va_end(a);
  note(p);
  int (*real)(const char *, int, ...) = dlsym(RTLD_NEXT, "open");
  return real(p, flags, mode);
}
int open64(const char *p, int flags, ...) {
  va_list a; va_start(a, flags); int mode = va_arg(a, int); va_end(a);
  note(p);
  int (*real)(const char *, int, ...) = dlsym(RTLD_NEXT, "open64");
  return real(p, flags, mode);
}
int openat(int d, const char *p, int flags, ...) {
  va_list a; va_start(a, flags); int mode = va_arg(a, int); va_end(a);
  note(p);
  int (*real)(int, const char *, int, ...) = dlsym(RTLD_NEXT, "openat");
  return real(d, p, flags, mode);
}
