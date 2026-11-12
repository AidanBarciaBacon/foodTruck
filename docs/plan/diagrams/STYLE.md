# Diagram style: one look for every diagram in the plan

Every diagram in `docs/plan/diagrams/` is a hand-written SVG that follows this sheet, so the set reads as one system.
The reader is the builder: someone who can 3D-model and print, has never soldered, and will work from these drawings.

## Canvas

- `viewBox="0 0 1200 750"` (landscape). Use `0 0 1200 900` only when the drawing truly needs the height. No `width` /
  `height` attributes in pixels: `width="100%"` so it scales. (`build-review.sh` gives the page's copies a pixel
  size, since an `<img>` needs one.)
- First element: a full-size background `<rect>` filled `#FFFBF2` (paper), so it reads on a dark or a light page.
- Keep a 40 px margin clear on every side.
- One title, top left at (40, 56): 26 px, weight 700, ink. One subtitle line under it at (40, 84): 15 px, grey ink.
  The title says what the drawing shows in plain words ("Side view: where the screen sits"), never a figure number.

## Colours (use these, no others)

| Role | Hex |
|---|---|
| Paper (background) | `#FFFBF2` |
| Ink (outlines, main text) | `#1F2933` |
| Grey ink (secondary text, dimension lines) | `#5F6B7A` |
| Light line (grid, hidden edges, leaders) | `#B8C0CC` |
| Printed plastic, truck body (fill) | `#FFE8CC` |
| Printed plastic, second part (fill) | `#FFD8A8` |
| Screen / e-paper (fill) | `#E7F5FF`, active area outline `#1971C2` |
| Electronics board (fill) | `#D3F9D8`, outline `#2F9E44` |
| Battery (fill) | `#FFF3BF`, outline `#E67700` |
| Accent / call-out, the thing to notice | `#E8590C` |
| Cloud / software boxes (fill) | `#F3F0FF`, outline `#6741D9` |
| Warning | `#C92A2A` |

Use colour for meaning (a part's kind), the same way in every drawing: the battery is always yellow, the board always
green, the screen always blue, printed plastic always peach. Never colour for decoration.

## Lines and text

- Font: `font-family="-apple-system, 'SF Pro Text', 'Helvetica Neue', Helvetica, Arial, sans-serif"` on the root.
- Text sizes: labels 15 px, notes 13 px, nothing under 13 px. Numbers in dimensions 14 px, weight 600.
- Outlines 2 px ink, `stroke-linejoin="round"`. Hidden or internal edges 1.5 px dashed `6 5` in light line.
- Dimension lines: 1.25 px grey ink, with small filled arrowheads (one shared `<marker>`), extension lines that stop
  3 px short of the part, and the number centred above the line on a paper-coloured backing rect so no line runs
  through it. Dimensions read **mm first, inches in brackets**: `229 mm (9.0 in)`.
- Leaders (label to part): 1.25 px grey ink, ending in a 3 px dot on the part. Labels sit outside the part where there
  is room, left- or right-aligned to a common edge so they line up.
- Corners: `rx="6"` on boxes in flow diagrams, true shapes in mechanical drawings.
- Flow arrows: 2 px ink with a filled arrowhead; a label on an arrow sits on a paper backing rect.
- A small legend (bottom left, inside the margin) whenever a colour's meaning is not obvious from a label beside it.
- A scale note on mechanical drawings ("Drawn to scale, 1 px = 0.25 mm" or whatever was used). Mechanical drawings ARE
  to scale: pick a scale and place everything by arithmetic from `docs/plan/SPEC.md`, never by eye.

## Rules

- No text overlaps anything: another label, a line, or an outline. No text runs off the canvas or out of its box.
- Plain words. No part numbers in labels unless the label is the part's name; no jargon without its plain meaning
  the first time ("FPC, the flat ribbon cable").
- Every number shown comes from `docs/plan/SPEC.md`. If the spec lacks a number you need, leave the dimension out and
  say so in your report: never invent one.
- No external images, fonts, scripts or links. No `<foreignObject>`. No filters or drop shadows. Plain SVG 1.1.
- Check your own drawing before reporting: render it to a PNG and look at it (`node
  ~/Desktop/BaconTools/bin/bt.mjs browse open <file.svg>` then `bt browse shot <out.png>`, or `bt look`), zoom into
  each quarter, and fix every overlap, clipped label and crooked line you see. Repeat until clean. Also confirm it is
  well-formed: `xmllint --noout <file.svg>`.
