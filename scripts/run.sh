#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! command -v node &> /dev/null; then
    echo "ERROR: node not found. Please install Node.js from https://nodejs.org"
    exit 1
fi

exec node "$SCRIPT_DIR/dev-launcher.mjs" "$@"
