# Throwaway: a remote host for the remote-execution probe (row 021-02).
FROM node:24.22.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server rsync git ca-certificates \
 && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd \
 && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
# The probe mounts its public key at /root/.ssh/authorized_keys.
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
