# Throwaway: the remote host for the runner-split probe (row 021-04). Same base as row 021-02's.
FROM node:24.22.1-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssh-server rsync git ca-certificates procps \
 && rm -rf /var/lib/apt/lists/* && mkdir -p /run/sshd \
 && sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
EXPOSE 22
CMD ["/usr/sbin/sshd", "-D", "-e"]
