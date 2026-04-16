# `scripts/` — Build & Run Scripts

> Cross-platform launcher scripts for the AstraXML development environment.

## Purpose

This directory contains shell scripts that automate the setup and launch process for the AstraXML Tauri development server. They handle dependency checking, npm installation, and starting the Tauri dev server with hot-reload.

---

## Files

### `run.bat` — Windows Launcher (14 lines)

Batch script for Windows development:

```
1. Check npm is installed (where npm)
   └── If not found: prints error and exits
2. cd to astraxml/ directory
3. npm install (install/update dependencies)
4. npm run tauri dev (start Tauri dev server)
```

**Usage:**
```cmd
cd C:\Users\davon\Desktop\XML
scripts\run.bat
```

**What it does:**
1. Verifies Node.js/npm is available on the system
2. Changes to the `astraxml/` directory (where `package.json` lives)
3. Runs `npm install` to ensure all frontend dependencies are current
4. Launches `npm run tauri dev` which:
   - Starts the Vite dev server (React frontend with hot-reload)
   - Compiles the Rust backend (`cargo build`)
   - Opens the Tauri desktop window pointing at the Vite server
   - Enables hot-reload: frontend changes appear instantly, Rust changes trigger recompile

### `run.sh` — Unix/macOS Launcher (11 lines)

Bash script with the same logic for Linux/macOS:

```bash
#!/bin/bash
# Same flow as run.bat:
# 1. Check npm
# 2. cd astraxml/
# 3. npm install
# 4. npm run tauri dev
```

**Usage:**
```bash
cd ~/Desktop/XML
chmod +x scripts/run.sh  # first time only
./scripts/run.sh
```

---

## Prerequisites

Before running these scripts, ensure:

| Requirement | Check Command | Install Guide |
|-------------|---------------|---------------|
| **Node.js 18+** | `node --version` | [nodejs.org](https://nodejs.org) |
| **npm** | `npm --version` | Comes with Node.js |
| **Rust 1.70+** | `rustc --version` | [rustup.rs](https://rustup.rs) |
| **Cargo** | `cargo --version` | Comes with Rust |

On Windows, you also need the MSVC build tools (Visual Studio Build Tools or full Visual Studio with C++ workload).

---

## Game Modding Context

These scripts provide a one-command launch for the development environment. Game modders who want to contribute to AstraXML or build from source can simply:

1. Clone the repository
2. Run `scripts/run.bat` (Windows) or `scripts/run.sh` (Unix)
3. The editor opens with hot-reload for immediate development

No manual dependency management or build configuration required.
