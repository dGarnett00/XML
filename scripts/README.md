# `scripts/` — Build & Run Scripts

> Structured launch tooling for the AstraXML development environment.

## Overview

The launcher flow now goes through a shared Node entrypoint: `scripts/dev-launcher.mjs`.

That launcher is responsible for turning noisy startup output into a concise dev-session timeline with the following goals:

1. Make the startup phases obvious.
2. Remove repeated `npm install` noise when manifests have not changed.
3. Surface the milestones that actually matter during development.
4. Preserve a complete raw session log for debugging when something fails.

## Files

### `dev-launcher.mjs`

Cross-platform orchestrator for Windows, macOS, and Linux. It provides:

1. **Preflight validation**
   Verifies `node`, `npm`, `cargo`, and `rustc` are available before launch.

2. **Smart dependency handling**
   Computes a fingerprint from `package.json` and `package-lock.json`. If the fingerprint matches the last successful install and `node_modules/` exists, it skips `npm install` and tells you why.

3. **Structured milestone logging**
   Condenses the Tauri/Vite/Cargo startup stream into readable phases such as:
   - workspace detection
   - toolchain summary
   - dependency decision
   - Vite ready URL
   - Rust compile start and finish
   - desktop process launch

4. **Raw session capture**
   Stores the full unfiltered child-process output in `astraxml/logs/dev/` for post-mortem debugging.

5. **Noise controls**
   Supports:
   - `--dry-run` to validate setup without launching Tauri
   - `--verbose` to stream raw child-process lines to the console
   - `--json` to emit newline-delimited JSON events for CI/tasks and machine-readable diagnostics
   - `--force-install` to bypass manifest caching and run `npm install`

6. **Startup summary**
   Emits a final compact startup summary after the desktop process launches, including total time-to-desktop plus key phase timings.

### `task-launcher-json.mjs`

Task-focused wrapper around `dev-launcher.mjs`.

It always runs the launcher in `--json` mode and mirrors the NDJSON stream to:

- `astraxml/logs/tasks/launcher-task-latest.ndjson`
- `astraxml/logs/tasks/launcher-task-<timestamp>.ndjson`

This keeps VS Code task output machine-readable while also leaving a stable artifact path for follow-up tooling.

### `run.bat`

Windows wrapper that checks for `node` and forwards arguments into `dev-launcher.mjs`.

### `run.sh`

Unix/macOS wrapper that checks for `node` and forwards arguments into `dev-launcher.mjs`.

## Usage

### Standard launch

```cmd
cd C:\Users\davon\Desktop\XML
scripts\run.bat
```

```bash
cd ~/Desktop/XML
chmod +x scripts/run.sh  # first time only
./scripts/run.sh
```

### Diagnostic modes

```cmd
scripts\run.bat --dry-run
scripts\run.bat --verbose
scripts\run.bat --json
scripts\run.bat --force-install
```

```bash
./scripts/run.sh --dry-run
./scripts/run.sh --verbose
./scripts/run.sh --json
./scripts/run.sh --force-install
```

### JSON mode

`--json` switches console output to NDJSON. Each line is a standalone JSON object with fields such as:

- `timestamp`
- `sessionId`
- `status`
- `label`
- `message`
- `event`
- `data`

This is intended for CI logs, VS Code tasks, and other tools that need stable machine-readable diagnostics.

The final `startup_summary` event includes total time-to-desktop and the captured phase timings in milliseconds.

### VS Code task

The workspace includes a task in [.vscode/tasks.json](.vscode/tasks.json) named `AstraXML: Dev Launcher JSON Artifact`.

That task runs `scripts/task-launcher-json.mjs`, keeps the console stream in NDJSON form, writes the task artifacts under `astraxml/logs/tasks/`, and marks the background task as ready when the launcher emits `startup_summary`.

## Launcher Plan

The launcher was redesigned around a five-phase startup model.

1. **Preflight**
   Fail fast with one clear message if the machine is missing a required tool.

2. **Dependency decision**
   Replace unconditional `npm install` output with an explicit decision: install, skip, or force-install.

3. **Milestone stream**
   Translate Tauri's nested npm/Vite/Cargo output into a readable event timeline instead of raw interleaved process chatter.

4. **Failure context**
   Show the important error line immediately and keep the full raw transcript on disk.

5. **Repeatability**
   Cache the last successful dependency fingerprint so repeated local launches stay quiet and predictable.

## Prerequisites

Before running these scripts, ensure:

| Requirement | Check Command | Install Guide |
|-------------|---------------|---------------|
| **Node.js 18+** | `node --version` | [nodejs.org](https://nodejs.org) |
| **npm** | `npm --version` | Comes with Node.js |
| **Rust 1.70+** | `rustc --version` | [rustup.rs](https://rustup.rs) |
| **Cargo** | `cargo --version` | Comes with Rust |

On Windows, you also need the MSVC build tools (Visual Studio Build Tools or full Visual Studio with C++ workload).
