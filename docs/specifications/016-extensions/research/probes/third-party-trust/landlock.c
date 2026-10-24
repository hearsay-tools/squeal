/* Unprivileged Landlock: allow reads only under argv[1], then exec argv[2..].
   Shows whether a kernel read allow list is available without root. */
#define _GNU_SOURCE
#include <fcntl.h>
#include <linux/landlock.h>
#include <stdio.h>
#include <sys/prctl.h>
#include <sys/syscall.h>
#include <unistd.h>
int main(int argc, char **argv) {
  int abi = syscall(SYS_landlock_create_ruleset, NULL, 0, LANDLOCK_CREATE_RULESET_VERSION);
  printf("landlock ABI: %d\n", abi);
  fflush(stdout);
  if (abi < 1) return 2;
  struct landlock_ruleset_attr attr = {
    .handled_access_fs = LANDLOCK_ACCESS_FS_READ_FILE | LANDLOCK_ACCESS_FS_READ_DIR |
                         LANDLOCK_ACCESS_FS_EXECUTE};
  int rs = syscall(SYS_landlock_create_ruleset, &attr, sizeof attr, 0);
  const char *allowed[] = {argv[1], "/usr", "/lib", "/lib64", "/etc", "/proc", "/dev"};
  for (unsigned i = 0; i < sizeof allowed / sizeof *allowed; i++) {
    struct landlock_path_beneath_attr pb = {
      .allowed_access = attr.handled_access_fs, .parent_fd = open(allowed[i], O_PATH | O_CLOEXEC)};
    if (pb.parent_fd >= 0) syscall(SYS_landlock_add_rule, rs, LANDLOCK_RULE_PATH_BENEATH, &pb, 0);
  }
  prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0);
  if (syscall(SYS_landlock_restrict_self, rs, 0)) { perror("restrict_self"); return 3; }
  execv(argv[2], argv + 2);
  perror("execv");
  return 4;
}
