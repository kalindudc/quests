#!/usr/bin/env bash
# Set up development environment
# Runs automatically after npm install via the prepare lifecycle hook

set -euo pipefail

echo "==> Checking Node.js..."
if ! command -v node &>/dev/null; then
  echo "Error: node is required. Install via fnm: https://github.com/Schniz/fnm"
  exit 1
fi
echo "  node $(node --version)"

echo "==> Checking pi..."
if ! command -v pi &>/dev/null; then
  echo "Error: pi is required. Install with: npm install -g @earendil-works/pi-coding-agent"
  exit 1
fi
echo "  pi $(pi --version 2>/dev/null || echo '(version unavailable)')"

echo "==> Configuring git hooks..."
git config core.hooksPath .githooks
echo "  Git hooks path set to .githooks"

echo "==> Creating tmp/ directory..."
mkdir -p tmp/

echo "==> Linking session directory..."
rm -rf tmp/sessions
ln -s "$HOME/.pi/agent/sessions" tmp/sessions
echo "  Session files can be found in ./tmp/sessions/"

echo "==> Linking log directory..."
mkdir -p /tmp/logs/pi-quests
rm -rf tmp/logs
ln -s /tmp/logs/pi-quests tmp/logs
echo "  Debug logs can be found in ./tmp/logs/"

echo ""
echo "Development environment ready."
echo ""
echo "  npm test        run unit tests"
echo "  npm run typecheck   TypeScript type check"
echo "  npm run style       lint and format check"
echo "  npm run dev         load extension into pi"
echo ""
