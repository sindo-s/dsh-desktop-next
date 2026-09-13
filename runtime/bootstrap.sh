#!/bin/bash
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl xz-utils bubblewrap git build-essential python3
if ! id dsh >/dev/null 2>&1; then useradd --create-home --shell /bin/bash dsh; fi
version=v24.20.0
case "$(uname -m)" in x86_64) arch=x64;; aarch64) arch=arm64;; *) echo 'Unsupported architecture' >&2; exit 1;; esac
archive="node-${version}-linux-${arch}"
if [ ! -x "/opt/${archive}/bin/node" ]; then
  stage=$(mktemp -d /tmp/dsh-node.XXXXXX)
  cd "$stage"
  curl --fail --location --retry 3 --max-time 600 -O "https://nodejs.org/dist/${version}/${archive}.tar.xz"
  curl --fail --location --retry 3 --max-time 60 -O "https://nodejs.org/dist/${version}/SHASUMS256.txt"
  grep " ${archive}.tar.xz$" SHASUMS256.txt | sha256sum --check --strict -
  tar -xJf "${archive}.tar.xz" -C /opt
fi
ln -sfn "/opt/${archive}/bin/node" /usr/local/bin/node
ln -sfn "/opt/${archive}/bin/npm" /usr/local/bin/npm
ln -sfn "/opt/${archive}/bin/npx" /usr/local/bin/npx
if [ ! -x /opt/dsh-tools/bin/pnpm ]; then
  npm install --global --prefix /opt/dsh-tools --no-audit --no-fund --registry=https://registry.npmjs.org pnpm@11.19.0
fi
ln -sfn /opt/dsh-tools/bin/pnpm /usr/local/bin/pnpm
install -d -m 700 -o dsh -g dsh /home/dsh/.local/share/dsh-next
install -d -o dsh -g dsh /home/dsh/projects
printf 'dsh-desktop-next/v1\n' > /etc/dsh-next-owned
runuser -u dsh -- bwrap --ro-bind / / --dev /dev --proc /proc --die-with-parent -- true
node --version
