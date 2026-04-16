# `.github/workflows/` — CI/CD Pipelines

> Automated cross-platform build and release pipeline for AstraXML desktop binaries.

## Purpose

This directory contains GitHub Actions workflow definitions that automate building, testing, and releasing AstraXML for all supported platforms. When a version tag is pushed, the pipeline builds native desktop installers for Windows, macOS, and Linux.

---

## Files

### `release.yml` — Cross-Platform Release Pipeline (58 lines)

#### Trigger

```yaml
on:
  push:
    tags:
      - 'v*.*.*'   # e.g., v0.1.0, v1.0.0-beta
```

The workflow runs when a semantic version tag is pushed to the repository.

#### Build Matrix

| Platform | Runner | Architecture | Output |
|----------|--------|--------------|--------|
| **Windows** | `windows-latest` | x86_64 | `.msi` installer |
| **macOS (ARM)** | `macos-latest` | aarch64 (Apple Silicon) | `.dmg` disk image |
| **macOS (Intel)** | `macos-latest` | x86_64 | `.dmg` disk image |
| **Linux** | `ubuntu-22.04` | x86_64 | `.deb` / `.AppImage` |

#### Pipeline Steps

1. **Checkout** — `actions/checkout@v4`
2. **Setup Node.js** — `actions/setup-node@v4` with Node 20
3. **Setup Rust** — `dtolnay/rust-toolchain@stable`
4. **Install dependencies** — `npm ci` in the `astraxml/` directory
5. **Build & Release** — `tauri-apps/tauri-action@v0`
   - Compiles the Rust backend for the target platform
   - Bundles the React frontend
   - Creates native installers
   - Uploads artifacts to a GitHub Release (draft mode)

#### Linux Dependencies

The Ubuntu runner installs additional system libraries required by Tauri:
```yaml
- libwebkit2gtk-4.1-dev
- libappindicator3-dev
- librsvg2-dev
- patchelf
```

#### Release Output

The workflow creates a **draft** GitHub Release with all platform binaries attached. This allows the maintainer to review the build artifacts, write release notes, and publish when ready.

---

## How to Release

```bash
# 1. Update version in package.json and Cargo.toml
# 2. Commit the version bump
git add -A
git commit -m "chore: bump version to 0.2.0"

# 3. Create and push a version tag
git tag v0.2.0
git push origin main --tags

# 4. GitHub Actions builds all platforms automatically
# 5. Check the draft release at github.com/dGarnett00/XML/releases
# 6. Edit release notes and publish
```

---

## Game Modding Context

The cross-platform build pipeline ensures game modders can install AstraXML regardless of their setup:

- **Windows** — Primary target (most DayZ server admins use Windows)
- **macOS** — For modders on Mac (both Intel and Apple Silicon supported)
- **Linux** — For modders running dedicated servers on Linux

The `.msi` installer on Windows provides a familiar install experience. The draft release mode prevents untested builds from going live — maintainers review artifacts before publishing to the modding community.
