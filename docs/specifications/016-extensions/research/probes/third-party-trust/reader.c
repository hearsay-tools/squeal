/* Reads the file named in argv[1], or in $PROBE_DATA when argv[1] is "--env",
   with open(2), and prints the byte count. */
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
int main(int argc, char **argv) {
  char buf[64];
  const char *p = strcmp(argv[1], "--env") == 0 ? getenv("PROBE_DATA") : argv[1];
  int fd = open(p, O_RDONLY);
  if (fd < 0) { perror("open"); return 1; }
  ssize_t n = read(fd, buf, sizeof buf);
  close(fd);
  printf("read %zd bytes from %s\n", n, p);
  return 0;
}
