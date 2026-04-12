#!/usr/bin/env bash
set -e
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/../astraxml"

if ! command -v npm &> /dev/null; then
    echo "ERROR: npm not found. Please install Node.js from https://nodejs.org"
    exit 1
fi

echo "Installing dependencies..."
npm install
echo "Launching AstraXML..."
npm run tauri dev
