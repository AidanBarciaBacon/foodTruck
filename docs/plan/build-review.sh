#!/bin/bash
# Builds the Review Desk page for the plan. PLAN.md is one document; desk-page refuses a single document block over
# six screens, so this splits it into four parts by section number and builds one page with a block per part plus
# the questions block from review.json.
#   bash docs/plan/build-review.sh [out-dir]     (default /tmp/foodtruck-plan-page; prints desk-page's send line)
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="${1:-/tmp/foodtruck-plan-page}"
BT="${BT:-$HOME/Desktop/BaconTools}"
rm -rf "$out" && mkdir -p "$out/src/diagrams"
cp "$here"/diagrams/*.svg "$out/src/diagrams/"
python3 - "$here" "$out/src" <<'EOF'
import json, re, sys
here, src = sys.argv[1], sys.argv[2]
# The diagrams say width="100%" so they scale in a browser tab; inside a page's <img> that gives no size at all, so
# the page's copies get their pixel size from the viewBox.
import glob
for f in glob.glob(f"{src}/diagrams/*.svg"):
    t = open(f).read()
    w, h = re.search(r'viewBox="0 0 (\d+) (\d+)"', t).groups()
    t = t.replace('width="100%"', f'width="{w}" height="{h}"', 1)
    open(f, "w").write(t)
text = open(f"{here}/PLAN.md").read()
secs = re.split(r"(?m)^(?=## \d+\. )", text)
secs = [s for s in secs if s.startswith("## ")]
num = lambda s: int(re.match(r"## (\d+)\.", s).group(1))
parts = [("how", "1. How it works", range(1, 5)),
         ("truck", "2. The electronics and the truck", range(5, 8)),
         ("buy", "3. What to buy, print and learn", range(8, 11)),
         ("build", "4. Building it", range(11, 14))]
spec = json.load(open(f"{here}/review.json"))
questions = [b for b in spec["blocks"] if b["type"] != "doc"]
blocks = []
for pid, title, rng in parts:
    body = "".join(s for s in secs if num(s) in rng)
    assert body, pid
    open(f"{src}/{pid}.md", "w").write(body)
    blocks.append({"type": "doc", "id": pid, "title": title, "file": f"{pid}.md", "split": 2})
spec["blocks"] = blocks + questions
json.dump(spec, open(f"{src}/review.json", "w"), indent=2, ensure_ascii=False)
EOF
node "$BT/bin/bt.mjs" desk-page "$out/src/review.json" --out "$out/page" --ready
