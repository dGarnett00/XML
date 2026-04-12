# AstraXML

AstraXML is a desktop application built with [Tauri](https://tauri.app/) v2, React, TypeScript, and Vite.

## Getting Started

### Easiest way (one double-click)

- **Windows:** Double-click `scripts/run.bat` from the repo root.
- **Mac/Linux:** Run `bash scripts/run.sh` from the repo root.

Both scripts automatically install dependencies and launch the app in dev mode.

### Manual way

```bash
cd astraxml
npm install
npm run tauri dev
```

## Build a Release Installer

Push a version tag and GitHub Actions will build and publish downloadable installers (`.exe`/`.msi`, `.dmg`, `.AppImage`/`.deb`) automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The resulting installers will appear as assets on the GitHub Releases page.

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
