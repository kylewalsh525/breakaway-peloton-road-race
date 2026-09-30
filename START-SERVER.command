#!/bin/sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Install Node.js 22 or newer, then run this file again."
  exit 1
fi
node server/main.mjs
