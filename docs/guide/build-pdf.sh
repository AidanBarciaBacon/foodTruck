#!/bin/bash
# Builds the printable build guide as a PDF with headless Chrome (no window opens).
#   bash docs/guide/build-pdf.sh [out.pdf]     default: ~/Desktop/Desk Food Truck - Build Guide.pdf
# The plan's diagrams are copied with a white background (they are drawn on a cream "paper" colour, which wastes
# ink and prints grey) and a pixel size (an <img> needs one).
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-$HOME/Desktop/Desk Food Truck - Build Guide.pdf}"
chrome="${CHROME:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"
work="$(mktemp -d /tmp/foodtruck-guide.XXXXXX)"
mkdir -p "$work/diagrams"
cp "$here/guide.html" "$work/guide.html"
python3 - "$here/../plan/diagrams" "$work/diagrams" <<'PY'
import glob, os, re, sys
src, dst = sys.argv[1], sys.argv[2]
for f in glob.glob(f"{src}/*.svg"):
    t = open(f).read()
    w, h = re.search(r'viewBox="0 0 (\d+) (\d+)"', t).groups()
    t = t.replace('width="100%"', f'width="{w}" height="{h}"', 1)
    t = re.sub(r'#FFFBF2', '#FFFFFF', t, flags=re.I)
    open(os.path.join(dst, os.path.basename(f)), "w").write(t)
PY
"$chrome" --headless=new --disable-gpu --no-pdf-header-footer --user-data-dir="$work/profile" \
  --print-to-pdf="$work/guide.pdf" "file://$work/guide.html" >/dev/null 2>&1
mv "$work/guide.pdf" "$out"
echo "wrote $out"
echo "work dir: $work"
