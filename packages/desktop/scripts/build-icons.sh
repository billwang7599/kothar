#!/bin/sh
# Regenerates the app icon's PNG and ICNS, the UI's PNG favicon and the website's favicons, from their SVGs. macOS only (iconutil).
# The 16 and 32 px slots come from icon-16.svg and icon-32.svg, drawn for those sizes; the rest from icon.svg.
# Run from anywhere: packages/desktop/scripts/build-icons.sh. Set CHROME if Google Chrome isn't in /Applications.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
assets="$here/../assets"
public="$here/../../ui/public"
site="$here/../../../website/public"
tmp=$(mktemp -d)
iconset="$tmp/icon.iconset"
mkdir "$iconset"
# The apple-touch icon is full-bleed (iOS rounds it): icon.svg without its shadow, rim or tile clip, cropped to the tile.
sed -e 's/viewBox="0 0 1024 1024" width="1024" height="1024"/viewBox="100 100 824 824"/' \
  -e '/filter="url(#shadow)"/d' -e '/stroke-width="2"/d' -e 's/ clip-path="url(#body)"//' \
  "$assets/icon.svg" > "$tmp/touch.svg"

set -- "$assets/icon.svg:$assets/icon.png:1024" "$public/favicon.svg:$public/favicon.png:64"
cp "$public/favicon.svg" "$site/favicon.svg"
set -- "$@" "$public/favicon.svg:$site/favicon.png:64" "$tmp/touch.svg:$site/apple-touch-icon.png:180"
set -- "$@" "$assets/icon-16.svg:$iconset/icon_16x16.png:16"
set -- "$@" "$assets/icon-32.svg:$iconset/icon_16x16@2x.png:32"
set -- "$@" "$assets/icon-32.svg:$iconset/icon_32x32.png:32"
set -- "$@" "$assets/icon.svg:$iconset/icon_32x32@2x.png:64"
for size in 128 256 512; do
  set -- "$@" "$assets/icon.svg:$iconset/icon_${size}x${size}.png:$size"
  set -- "$@" "$assets/icon.svg:$iconset/icon_${size}x${size}@2x.png:$((size * 2))"
done
node "$here/render-svg.mjs" "$@"
iconutil -c icns -o "$assets/icon.icns" "$iconset"
rm -rf "$tmp"
echo "Wrote icon.png and icon.icns in $assets, favicon.png in $public, and the website's favicons in $site"
