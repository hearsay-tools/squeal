# Throwaway, row 005-110 (from 005-101). Drops one COPY's clean pages from the page cache (posix_fadvise DONTNEED, no root
# needed) and prints the share of its pages resident before and after (mincore).
# Without --evict it only reads residency (mincore reads and writes no content), also of a live store.
# Usage: python3 -I evict.py <store.sqlite> [--evict]
import ctypes, mmap, os, sys
path = sys.argv[1]
assert "--evict" not in sys.argv or "/t/cd01ba62/" in path, "evicts copies only"
libc = ctypes.CDLL("libc.so.6", use_errno=True)
def resident():
    fd = os.open(path, os.O_RDONLY); size = os.fstat(fd).st_size; page = mmap.PAGESIZE; total = 0; done = 0; chunk = 1 << 30
    libc.mmap.restype = ctypes.c_void_p; libc.mmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_int, ctypes.c_int, ctypes.c_int, ctypes.c_long]
    libc.munmap.argtypes = [ctypes.c_void_p, ctypes.c_size_t]; libc.mincore.argtypes = [ctypes.c_void_p, ctypes.c_size_t, ctypes.c_char_p]
    for off in range(0, size, chunk):
        n = min(chunk, size - off); addr = libc.mmap(None, n, mmap.PROT_READ, mmap.MAP_SHARED, fd, off)
        vec = ctypes.create_string_buffer((n + page - 1) // page); libc.mincore(addr, n, vec)
        total += len(vec.raw); done += sum(b & 1 for b in vec.raw); libc.munmap(addr, n)
    os.close(fd); return done / total
before = resident()
if "--evict" in sys.argv:
    fd = os.open(path, os.O_RDONLY); os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED); os.close(fd)
print(f"{path.replace(os.path.expanduser('~'), '~')}: resident {100*before:.1f}% before, {100*resident():.1f}% after")
