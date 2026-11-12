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

**State at install (2026-11-12): no code yet.** There is no source, no `package.json` and no git remote. So
`.claude/coord.conf` sets nothing yet, each for a plain reason:

| Setting | Value | Why |
|---|---|---|
| `CHECK_TYPECHECK`, `CHECK_TEST` | empty | No code and no test runner. `coord.sh check` passes without running anything, so a green check means nothing here yet. |
| `CHECK_PATH_PREPEND` | empty | No tools directory. |
| `SHARED_TREES` | empty | No source trees. `git add <repo root>` is refused all the same; stage explicit paths. |
| `BUILD_PATTERNS` | empty | No build, so no build lock. |
| `PUBLISH_PATTERNS` | empty | Nothing to publish beyond `git push`, and there is no remote to push to. |
| `INSTALL_PATTERNS` | empty | The project installs nothing on this Mac. |
| `COORD_SIBLINGS_CONF` | empty | No reference repo is read from here yet. |
| `PANE_POPUPS` | empty (the default) | A corner's question goes through the supervisor. |

### Rules of this project's own

- **Whoever scaffolds the project fills in `.claude/coord.conf` in the same commit**, and updates the table above:
  the real typecheck and test commands, the source trees as `SHARED_TREES`, the build command as `BUILD_PATTERNS`
  when sessions would share its output, and any reference repo it copies from as `COORD_SIBLINGS_CONF`. Until then
  no check guards the tree: say so when reporting work as checked.
- **There is no remote.** Creating a GitHub repo waits for the user's word (the shared rules, "Panes commit; the
  supervisor takes work out"); until one exists, "taking work out" stops at the local commit on `main`.
- **`main` is the only branch**, and the panes commit to it in this checkout.
