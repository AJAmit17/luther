#!/bin/sh
# Installs luther: the server that lets your phone drive the coding agents on
# this machine.
#
#   curl -fsSL https://raw.githubusercontent.com/AJAmit17/luther/main/install.sh | sh
#
# Downloads the release build for this OS and CPU (checksum verified), or, when
# there is no release yet, builds from source with Go. Settings (env):
#   LUTHER_VERSION  a tag, e.g. v0.2.0 (default: latest release)
#   LUTHER_BIN      install folder (default: ~/.local/bin)
#   GITHUB_TOKEN    for a private repository
#   LUTHER_REPO     git URL to build from (default: https://github.com/AJAmit17/luther.git)
set -eu

repo=AJAmit17/luther
bin=${LUTHER_BIN:-$HOME/.local/bin}
say() { printf '%s\n' "$*"; }
die() { say "luther install: $*" >&2; exit 1; }
have() { command -v "$1" >/dev/null 2>&1; }

copy_notices() {
  for name in LICENSE NOTICE; do
    [ -f "$1/$name" ] || continue
    mkdir -p "$2"
    install -m 0644 "$1/$name" "$2/$name"
  done
}

case $(uname -s) in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "unsupported OS $(uname -s) (macOS and Linux only)" ;;
esac
case $(uname -m) in
  x86_64 | amd64) arch=amd64 ;;
  arm64 | aarch64) arch=arm64 ;;
  *) die "unsupported CPU $(uname -m)" ;;
esac
have curl || die "needs curl"

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

auth() { if [ -n "${GITHUB_TOKEN:-}" ]; then printf 'Authorization: Bearer %s' "$GITHUB_TOKEN"; else printf 'X-No-Auth: 1'; fi; }
api() { curl -fsSL -H "$(auth)" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$repo/$1"; }

# A release asset by name: through the API (works for private repos with a token).
asset() { # tag name → file
  # one JSON field per line, whatever the formatting: an asset's id comes two lines before its name
  id=$(api "releases/tags/$1" | tr -d '\n\r' | tr ',{}' '\n\n\n' | grep -B3 "\"name\": *\"$2\"" | sed -n 's/.*"id": *\([0-9]*\).*/\1/p' | tail -1)
  [ -n "$id" ] || return 1
  curl -fsSL -H "$(auth)" -H "Accept: application/octet-stream" -o "$3" "https://api.github.com/repos/$repo/releases/assets/$id"
}

from_release() {
  tag=${LUTHER_VERSION:-}
  if [ -z "$tag" ]; then
    tag=$(api releases/latest 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -1)
  fi
  [ -n "$tag" ] || return 1
  name="luther_${os}_${arch}.tar.gz"
  say "· downloading luther $tag ($os/$arch)"
  asset "$tag" "$name" "$tmp/$name" || return 1
  asset "$tag" checksums.txt "$tmp/checksums.txt" || die "release $tag has no checksums.txt"
  want=$(grep " $name\$" "$tmp/checksums.txt" | cut -d' ' -f1)
  if have sha256sum; then got=$(sha256sum "$tmp/$name" | cut -d' ' -f1); else got=$(shasum -a 256 "$tmp/$name" | cut -d' ' -f1); fi
  [ -n "$want" ] && [ "$want" = "$got" ] || die "checksum mismatch for $name"
  tar -xzf "$tmp/$name" -C "$tmp"
}

from_source() {
  have go || die "no release to download, and Go isn't installed to build one (https://go.dev/dl)"
  have git || die "building from source needs git"
  url=${LUTHER_REPO:-https://github.com/$repo.git}
  say "· building luther from source ($url)"
  git clone -q --depth 1 ${LUTHER_VERSION:+--branch "$LUTHER_VERSION"} "$url" "$tmp/src"
  ver=$(git -C "$tmp/src" describe --tags --always 2>/dev/null || echo dev)
  (cd "$tmp/src/server" && CGO_ENABLED=0 go build -trimpath -ldflags "-s -w -X github.com/AJAmit17/luther/server/internal/protocol.Version=$ver" -o "$tmp/luther" .)
  copy_notices "$tmp/src" "$tmp"
}

from_release || from_source

mkdir -p "$bin"
install -m 0755 "$tmp/luther" "$bin/luther"
copy_notices "$tmp" "${XDG_DATA_HOME:-$HOME/.local/share}/luther"
say "✓ installed $("$bin/luther" version) → $bin/luther"
case ":$PATH:" in
  *":$bin:"*) ;;
  *) say "! $bin isn't on your PATH; add it: export PATH=\"$bin:\$PATH\"" ;;
esac
say "
Next:
  luther doctor            what's installed, what's missing
  luther tailscale         a route over your tailnet (and/or: luther tunnel)
  luther service install   run it now and at login
  luther pair              QR for the Luther app"
