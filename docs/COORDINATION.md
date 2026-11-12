# Coordination

<!-- bacontools-coordination-stub: Bridge Crew keeps the shared rules; this file is this project's own. -->

The board's rules, the same for every project, are in `~/.bacontools/board/COORDINATION.md`: read that file first,
with the Read tool (it is outside this checkout, so nothing loads it for you). Bridge
Crew keeps it at the BaconTools template, as it keeps the shared `coord.sh`, so a rule changed there reaches every
project. This file adds only what is this project's own; where the two differ, this file wins.

## This project

**What this project is:** a desk-sized, 3D-printed food truck with a colour e-paper screen that shows which food
trucks are outside the office today, battery powered. It is a hardware build the user carries out; the crew writes
the plan and, later, the software (the morning job, the web page, the renderer, the firmware). It is not a game.

- `docs/plan/PLAN.md` is the build plan; `docs/plan/SPEC.md` is the one source for every number in it and in the
  diagrams (`docs/plan/diagrams/*.svg`, drawn to `diagrams/STYLE.md`). Change a number in SPEC first, then wherever
  it is shown.
- `bash docs/plan/build-review.sh` builds the plan's Review Desk page (it prints the send line).

- `job/` is the morning job (Node 22.12+): it reads Off the Grid's feed and writes the page, the six-colour
  picture and `status.json` into `dist/`. `docs/software/CONTRACT.md` is what the job, the page and the firmware
  agree on: change it there first. `cd job && npm ci && npm test`, and `node job/build.mjs` runs it for real.
- `firmware/` is the truck's program (PlatformIO, FireBeetle 2 ESP32-E). `firmware/README.md` says how to build it.
- `docs/guide/` is the printable step-by-step guide; `bash docs/guide/build-pdf.sh` prints it to the Desktop.

What `.claude/coord.conf` sets:

| Setting | Value | Why |
|---|---|---|
| `CHECK_TYPECHECK` | empty | The job is plain JavaScript; there is nothing to typecheck. |
| `CHECK_TEST` | `bt test-cache --package job` | The job's `node --test` suite, re-running only the files whose inputs changed. The firmware is not part of the check: it needs PlatformIO's toolchain and takes minutes. |
| `SHARED_TREES` | `job`, `job/lib`, `job/test`, `firmware`, `firmware/src`, `docs/plan/diagrams` | Stage the files you changed, never these folders whole. |
| `BUILD_PATTERNS` | empty | The job's build writes only `dist/`, which is git-ignored and cheap; no build lock. |
| `PUBLISH_PATTERNS` | `gh workflow run` | Running the morning workflow republishes the live picture, so it is the supervisor's. `git push` is too, as always. |
| `INSTALL_PATTERNS` | empty | PlatformIO installs into `firmware/.venv` and `~/.platformio`; nothing is gated. |
| `COORD_SIBLINGS_CONF` | empty | No reference repo. |
| `PANE_POPUPS` | empty (the default) | A corner's question goes through the supervisor. |

### Rules of this project's own

- **The feed is read once a morning, and that is all.** Off the Grid's `robots.txt` asks crawlers to stay off the
  feed's host; the user chose to read it anyway, for one small request a day. Tests never touch the network (they
  use the fixture in `job/test/fixtures/`), and nobody loops over the feed while developing: one request, saved to
  a scratch file, then work from the file.
- **The remote is `github.com/AidanBarciaBacon/foodTruck`, public,** and everything pushed is published. Commit
  with the repo's configured no-reply address (never the user's own email: the history was rewritten once to
  remove it), and put nothing private in a commit: no Wi-Fi names or passwords, no tokens, no home-folder paths.
- **The picture is live at `aidanbarciabacon.github.io/foodTruck`**, published by `.github/workflows/morning.yml`
  each morning. A push to `main` does not publish; the workflow does (run it by hand with `gh workflow run
  morning.yml` after a change to the job or the page, and that is the supervisor's to do).
- **`main` is the only branch**, and the panes commit to it in this checkout.
- **Nothing here is proven on hardware yet.** Say "compiles" or "tested without hardware", never "works", about
  the firmware until the user has run it on the bench.
