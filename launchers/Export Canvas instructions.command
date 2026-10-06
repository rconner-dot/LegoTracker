#!/bin/sh
# Double-click to save all assignment instructions from Canvas into the "instructions" folder.
cd "$(dirname "$0")" || exit 1
if [ -x ./node/bin/node ]; then NODE=./node/bin/node; else NODE=node; fi
"$NODE" scripts/export-instructions.js "$@" && [ -d instructions ] && open instructions
printf "  Press Return to close. "
read -r _
