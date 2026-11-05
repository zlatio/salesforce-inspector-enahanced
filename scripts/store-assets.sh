#!/usr/bin/env bash
# Renders the Chrome Web Store promo tiles, the popup/side panel screenshot and the store icon into docs/store/.
# Needs chromium, ImageMagick (magick) and rsvg-convert.
set -euo pipefail
root=$(cd "$(dirname "$0")/.." && pwd)
store="$root/docs/store"
tmp=$(mktemp -d)
trap 'rm -r "$tmp"' EXIT

# Render at 2x, then downscale, so text and edges are crisp. The store wants 24-bit PNGs without alpha.
render() { # <html file> <width> <height> <output>
  chromium --headless --disable-gpu --hide-scrollbars --allow-file-access-from-files --user-data-dir="$tmp/profile" \
    --force-device-scale-factor=2 --window-size="$2,$3" --virtual-time-budget=2000 \
    --screenshot="$tmp/shot.png" "file://$store/src/$1" >/dev/null 2>&1
  magick "$tmp/shot.png" -filter Lanczos -resize "$2x$3!" -alpha off -strip "PNG24:$4"
  echo "wrote ${4#"$root"/} ($2x$3)"
}

render promo-small.html 440 280 "$store/promo-small.png"
render promo-marquee.html 1400 560 "$store/promo-marquee.png"
render popup-sidepanel.html 1280 800 "$store/screenshots/5-popup-sidepanel.png"

# Store icon: 96x96 artwork centred on a transparent 128x128 canvas, per the store's icon guidelines.
rsvg-convert -w 96 -h 96 "$root/assets/icon.svg" -o "$tmp/icon96.png"
magick "$tmp/icon96.png" -background none -gravity center -extent 128x128 -strip "$store/icon-128.png"
echo "wrote docs/store/icon-128.png (128x128)"
