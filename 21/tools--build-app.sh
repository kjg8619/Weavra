#!/bin/bash
set -eu
export PATH="/Users/kangjingoo/.nvm/versions/node/v24.19.0/bin:$PATH"
export GIT_MASTER=1
export NODE_OPTIONS="${NODE_OPTIONS:-} --dns-result-order=ipv4first"
WT=$1
DEST=$2
test ! -e "$DEST"
mkdir -p "$DEST/package" "$DEST/app"
GIT_MASTER=1 git -C "$WT" rev-parse HEAD > "$DEST/revision.txt"
GIT_MASTER=1 git -C "$WT" diff HEAD --binary > "$DEST/tracked-diff.patch"
shasum -a 256 "$DEST/tracked-diff.patch"
cd "$WT/app/t3code"
T3CODE_DESKTOP_SIGNED=false T3CODE_DESKTOP_SKIP_BUILD=false \
  pnpm run dist:desktop:artifact --platform mac --target zip --arch arm64 --output-dir "$DEST/package"
VERSION="$(node -p "require('./apps/server/package.json').version")"
/usr/bin/ditto -x -k "$DEST/package/Weavra-$VERSION-arm64.zip" "$DEST/app"
test -x "$DEST/app/weavra-desktop.app/Contents/MacOS/weavra-desktop"
shasum -a 256 "$DEST/app/weavra-desktop.app/Contents/Resources/app.asar"
printf 'BUILD_DONE %s\n' "$DEST"
