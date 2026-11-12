# The morning job

Reads today's food trucks, lays them out on the page, photographs the page in headless Chrome and writes the
picture for the truck's screen. What the files mean is in `docs/software/CONTRACT.md`.

## Run it

Needs Node 22.12 or newer and Google Chrome (no browser is downloaded).

```
cd job
npm ci
npm test
node build.mjs
```

The files go to `dist/` at the repo root (git-ignored): `index.html`, `page.css`, `page.js`, `today.json`,
`today.png`, `today.bin` (exactly 192,000 bytes) and `status.json`. Open `dist/today.png` to see the picture.

`npm test` needs no network. The two tests that take a real screenshot are skipped, with the reason, when no
Chrome is found.

## Options

| Option | What |
|---|---|
| `--out <dir>` | where the files go, instead of `dist/` |
| `--now <ISO time>` | run as if it were this moment, e.g. `2026-11-12T06:30:00-08:00` |
| `--data <file>` | skip the feed and show this `today.json` (one of the page's samples, say) |
| `--market-dates a,b,c` | with `--data`: the market days (`YYYY-MM-DD`) the next wake is worked out from; none by default |
| `--lib <dir>`, `--page <dir>` | for testing: take the other modules, or the page, from another folder |

Environment:

- `PAGE_URL`: the address printed on the picture. Nothing by default.
- `CHROME_PATH`: the Chrome to use. Otherwise `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome` on
  a Mac, `/usr/bin/google-chrome` or `/usr/bin/chromium-browser` on Linux.
- `CHROME_NO_SANDBOX=1`: start Chrome without its sandbox, for a Linux container that cannot run one.

For example, a sample day without touching the feed:

```
node build.mjs --data <a today.json> --market-dates 2026-11-16 --out /tmp/truck
```

## What can go wrong

- **The feed cannot be read.** The job still writes every file, with the "Couldn't read the truck list today"
  picture, prints a warning and exits 0.
- **Anything else** (no Chrome, the page never says it is drawn within 15 seconds, `today.bin` not 192,000
  bytes): it says what, exits 1 and writes no `status.json`.

## Every morning

`.github/workflows/morning.yml` runs the tests and `node build.mjs` at about 6:30 AM in Los Angeles, summer and
winter, and publishes `dist/` to GitHub Pages. It can also be started by hand from the Actions tab.
