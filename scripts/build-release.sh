#!/bin/sh
# Builds luther for every supported OS/CPU into dist/: luther_<os>_<arch>.tar.gz
# plus checksums.txt. Used by .github/workflows/release.yml; runs locally too.
#   scripts/build-release.sh v0.2.0
set -eu
version=${1:?usage: scripts/build-release.sh vX.Y.Z}
root=$(cd "$(dirname "$0")/.." && pwd)
dist="$root/dist"
rm -rf "$dist" && mkdir -p "$dist"
cd "$root/server"
for target in darwin/arm64 darwin/amd64 linux/amd64 linux/arm64; do
  os=${target%/*} arch=${target#*/}
  work="$dist/luther_${os}_${arch}"
  mkdir -p "$work"
  CGO_ENABLED=0 GOOS=$os GOARCH=$arch go build -trimpath \
    -ldflags "-s -w -X github.com/AJAmit17/luther/server/internal/protocol.Version=$version" \
    -o "$work/luther" .
  cp "$root/LICENSE" "$root/NOTICE" "$work/"
  COPYFILE_DISABLE=1 tar -C "$work" -czf "$work.tar.gz" luther LICENSE NOTICE
  rm -rf "$work"
done
cd "$dist"
if command -v sha256sum >/dev/null; then sha256sum ./*.tar.gz; else shasum -a 256 ./*.tar.gz; fi | sed 's| \./| |' > checksums.txt
cat checksums.txt
