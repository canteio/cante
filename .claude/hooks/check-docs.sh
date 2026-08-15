#!/usr/bin/env bash
# Stop hook: if code changed but CLAUDE.md didn't, send Claude back to update it.
#
# Self-terminating by design: updating CLAUDE.md makes it the newest file, so
# the next Stop passes. The 15-minute marker is the escape hatch for the case
# where a change genuinely doesn't belong in the docs — it can't loop forever.
set -uo pipefail

cd "$(dirname "$0")/../.." || exit 0
[ -f CLAUDE.md ] || exit 0

changed=$(find lib app components scripts \
  drizzle.config.ts next.config.ts package.json tsconfig.json \
  -type f \( -name '*.ts' -o -name '*.tsx' -o -name '*.css' -o -name '*.json' \) \
  -newer CLAUDE.md 2>/dev/null | head -8)

[ -z "$changed" ] && exit 0

marker=".claude/.docs-reminded"
now=$(date +%s)
if [ -f "$marker" ]; then
  last=$(cat "$marker" 2>/dev/null || echo 0)
  [ $((now - last)) -lt 900 ] && exit 0
fi
echo "$now" >"$marker"

jq -cn --arg f "$(echo "$changed" | tr '\n' ' ')" '{
  decision: "block",
  reason: ("These files are newer than CLAUDE.md: " + $f
    + "\nUpdate CLAUDE.md to match what actually changed — and readme.md, appplan.md, or plan.md if the change touches status, architecture, or scope. Record what was verified versus assumed. If the change genuinely does not belong in any doc, say so in one line and stop."),
  systemMessage: "Docs check: code is newer than CLAUDE.md."
}'
