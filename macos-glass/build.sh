#!/bin/bash
# Build this Thunderbird fork (Superhuman look + Liquid Glass) on macOS.
#
#   ./macos-glass/build.sh [workdir]
#
# Fetches the exact Firefox engine revision this branch was tested against,
# puts this repo at <engine>/comm, applies the native Liquid Glass patch,
# and runs a full optimized build. Needs Xcode 26+ (macOS 26 SDK), Rust,
# and about 40 GB free. First build: ~1-2 h on Apple silicon.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
COMM="$(cd "$HERE/.." && pwd)"
WORK="${1:-$HOME/src/tb-glass}"
GECKO_REV="$(cat "$HERE/GECKO_REV")"

mkdir -p "$WORK/firefox"
cd "$WORK/firefox"
if [ ! -d .git ]; then
  git init -q
  git remote add origin https://github.com/mozilla-firefox/firefox.git
fi
git fetch --depth 1 --no-tags origin "$GECKO_REV"
git checkout -q -B tb-glass-base FETCH_HEAD
[ -e comm ] || ln -s "$COMM" comm
git apply --check "$HERE/gecko-liquid-glass-sidebar.patch" 2>/dev/null \
  && git apply "$HERE/gecko-liquid-glass-sidebar.patch" \
  || echo "glass patch already applied (or engine differs); continuing"

cat > mozconfig <<'EOF'
ac_add_options --enable-project=comm/mail
mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-tb-full
ac_add_options --enable-optimize
ac_add_options --disable-debug
ac_add_options --disable-tests
ac_add_options --enable-bootstrap
EOF
export MOZCONFIG="$PWD/mozconfig"
./mach build
echo "Built: $PWD/obj-tb-full/dist/Thunderbird Daily.app"
