#!/usr/bin/env bash
# Tests the firmware's arithmetic on this Mac, with no board and no PlatformIO: the HTTP date parser, the
# sleep lengths, status.json, the battery mark, the 180-degree flip and the "Charge me" card.
#
#   bash firmware/test/run.sh                 run the tests
#   bash firmware/test/run.sh --card out.bmp  draw the "Charge me" card to a picture file instead
#   bash firmware/test/run.sh --mark out.bmp  draw the three battery marks, enlarged
#
# Needs only the system C++ compiler (Xcode's command line tools: xcode-select --install).
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
build="$(mktemp -d)"
trap 'rm -rf "$build"' EXIT

"${CXX:-c++}" -std=c++17 -Wall -Wextra -Werror -O1 \
  -I "$here/../include" \
  "$here/test_logic.cpp" -o "$build/test_logic"

"$build/test_logic" "$@"
