#!/bin/sh
# Double-click to start Class Quest on a Mac.
cd "$(dirname "$0")" || exit 1
if [ -x ./node/bin/node ]; then
  NODE=./node/bin/node
  # Files from the internet are quarantined by macOS; this folder is ours.
  xattr -dr com.apple.quarantine . 2>/dev/null
elif command -v node >/dev/null 2>&1; then
  NODE=node
else
  echo ""
  echo "  Class Quest can't find Node.js."
  echo "  Download the Mac zip of Class Quest (it has Node.js built in),"
  echo "  or install Node.js from https://nodejs.org"
  echo ""
  printf "  Press Return to close. "
  read -r _
  exit 1
fi
exec "$NODE" server.js --open "$@"
