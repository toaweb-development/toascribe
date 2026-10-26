#!/usr/bin/env bash
# Installs the two tools `pnpm release:check` needs that are not in the repo: trivy and actionlint, as single binaries in
# ~/.local/bin (or $BIN_DIR). No sudo, no package manager. Each version is pinned here with the sha256 of its Linux x86-64
# archive, taken from the project's own checksums file on its GitHub release; a download with another checksum is refused.
#
#   scripts/install-tools.sh            install what is missing or at another version
#
# To upgrade: change the version and the sha256 below (the checksums file is trivy_<v>_checksums.txt and
# actionlint_<v>_checksums.txt on the release page), and run the script again.
set -euo pipefail

TRIVY_VERSION=0.76.1
TRIVY_SHA256=c7cbe3137fb8a48a17574bede3dd6beb16742d1e9772929940fc90082c39d9c0
ACTIONLINT_VERSION=1.7.12
ACTIONLINT_SHA256=8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8

bin_dir="${BIN_DIR:-${HOME}/.local/bin}"

if [ "$(uname -s)-$(uname -m)" != Linux-x86_64 ]; then
  echo "This script pins the Linux x86-64 archives only; install trivy ${TRIVY_VERSION} and actionlint ${ACTIONLINT_VERSION} by hand." >&2
  exit 1
fi

work="$(mktemp -d)"
trap 'rm -rf "${work}"' EXIT
mkdir -p "${bin_dir}"

# install NAME URL SHA256: download into an empty folder, check the sum, unpack only the binary, install it.
install_tool() {
  local name="$1" url="$2" sum="$3" dir="${work}/$1"
  mkdir -p "${dir}"
  curl -fsSL --proto '=https' -o "${dir}/archive.tar.gz" "${url}"
  echo "${sum}  ${dir}/archive.tar.gz" | sha256sum --check --quiet - \
    || { echo "${name}: the checksum does not match ${sum}; nothing installed." >&2; exit 1; }
  tar -xzf "${dir}/archive.tar.gz" -C "${dir}" "${name}"
  install -m 0755 "${dir}/${name}" "${bin_dir}/${name}"
  echo "${name} installed in ${bin_dir}"
}

if [ "$("${bin_dir}/trivy" --version 2>/dev/null | head -1)" = "Version: ${TRIVY_VERSION}" ]; then
  echo "trivy ${TRIVY_VERSION} is installed"
else
  install_tool trivy \
    "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/trivy_${TRIVY_VERSION}_Linux-64bit.tar.gz" \
    "${TRIVY_SHA256}"
fi

if [ "$("${bin_dir}/actionlint" -version 2>/dev/null | head -1)" = "${ACTIONLINT_VERSION}" ]; then
  echo "actionlint ${ACTIONLINT_VERSION} is installed"
else
  install_tool actionlint \
    "https://github.com/rhysd/actionlint/releases/download/v${ACTIONLINT_VERSION}/actionlint_${ACTIONLINT_VERSION}_linux_amd64.tar.gz" \
    "${ACTIONLINT_SHA256}"
fi

case ":${PATH}:" in
  *":${bin_dir}:"*) ;;
  *) echo "Add ${bin_dir} to PATH." ;;
esac
