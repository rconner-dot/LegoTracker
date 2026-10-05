#!/bin/sh
# Start Class Quest on Linux (pass --lan to share on your network).
cd "$(dirname "$0")" || exit 1
if [ -x ./node/bin/node ]; then NODE=./node/bin/node; else NODE=node; fi
exec "$NODE" server.js --open "$@"
