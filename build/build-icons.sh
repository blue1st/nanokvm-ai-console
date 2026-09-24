#!/bin/bash
set -e

DIR="$(cd "$(dirname "$0")" && pwd)"
ICON_PNG="$DIR/icon.png"
ICONSET="$DIR/icon.iconset"

mkdir -p "$ICONSET"

# Resize for macOS iconset
sips -z 16 16     "$ICON_PNG" --out "$ICONSET/icon_16x16.png" > /dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" > /dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET/icon_32x32.png" > /dev/null
sips -z 64 64     "$ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" > /dev/null
sips -z 128 128   "$ICON_PNG" --out "$ICONSET/icon_128x128.png" > /dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" > /dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET/icon_256x256.png" > /dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" > /dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET/icon_512x512.png" > /dev/null
sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET/icon_512x512@2x.png" > /dev/null

# Generate ICNS
iconutil -c icns "$ICONSET" -o "$DIR/icon.icns"
rm -rf "$ICONSET"

echo "Generated: $DIR/icon.icns"
