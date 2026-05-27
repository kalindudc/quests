#!/usr/bin/env bash
# Load extension into pi
# Open 'npm run logs' in a second terminal to see debug output

set -euo pipefail

# npm scripts prepend node_modules/.bin to PATH, causing `pi` to resolve
# to the local devDependency instead of the globally installed one.
GLOBAL_PI=$(which -a pi 2>/dev/null | grep -v 'node_modules' | head -n 1)
if [ -z "$GLOBAL_PI" ]; then
  echo "Error: global pi not found. Install with: npm install -g @earendil-works/pi-coding-agent"
  exit 1
fi

export PI_QUESTS_DEBUG=1

mkdir -p /tmp/logs/pi-quests/

# Rotate: keep last session as .prev so nothing is lost
if [ -s /tmp/logs/pi-quests/debug.log ]; then
  cp /tmp/logs/pi-quests/debug.log /tmp/logs/pi-quests/debug.prev.log
fi

# Truncate debug log for new session
echo "" > /tmp/logs/pi-quests/debug.log

echo ""
echo "  pi-quests dev session starting"
echo "  Open a second terminal and run: npm run logs"
echo "  Log: ./tmp/logs/pi-quests/debug.log"
echo ""

echo "  pi version: $("$GLOBAL_PI" --version)"

exec "$GLOBAL_PI"
