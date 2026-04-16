# `lib/` — Utility Libraries

> Tauri API abstraction layer for native desktop capabilities.

## Purpose

This directory contains utility wrappers that abstract the Tauri native API behind clean, importable functions. This layer allows the frontend to invoke Rust backend commands and native OS dialogs (file open, file save) without directly coupling to Tauri's API internals. It also provides runtime detection for environments where Tauri may not be available (e.g., browser-only development).

---

## Files

### `tauri.ts`

A thin wrapper around `@tauri-apps/api/core` and `@tauri-apps/plugin-dialog` providing four exports:

#### `invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>`

Calls a Rust backend command through Tauri's IPC bridge. This is the primary communication channel between the React UI and the Rust engine. Every mutation, query, and file operation flows through this function.

**Game modding usage:**
```typescript
// Open a game XML file
const result = await invoke<OpenDocumentResult>('open_document', { path: filePath });

// Update an item's attribute (e.g., change spawn nominal)
await invoke('set_attribute', { nodeId, name: 'nominal', value: '15' });

// Serialize back to XML for export
const xml = await invoke<string>('serialize_document', { docId });
```

#### `openFileDialog(): Promise<string | null>`

Opens a native OS file picker dialog filtered to XML files (`*.xml`). Returns the selected file path or `null` if cancelled.

**Game modding usage:**
- Used by the Toolbar's "Open" button
- Filtered to `.xml` extension so modders see only their game config files

#### `saveFileDialog(): Promise<string | null>`

Opens a native OS save dialog filtered to XML files. Returns the chosen save path or `null`.

**Game modding usage:**
- Used by the "Export" button to save modified game configs
- Ensures the output file has a `.xml` extension

#### `isTauri(): boolean`

Runtime detection of the Tauri environment by checking for `window.__TAURI_INTERNALS__`. Returns `true` when running inside the Tauri desktop app, `false` when running in a browser (for development/testing).

**Used throughout the app to:**
- Skip IPC calls when running in browser-only mode
- Fall back to browser-native alternatives (e.g., `Blob` downloads instead of native file save)
- Gate features that require native access (file system, system dialogs)

---

## Architecture Role

```
┌──────────────┐     ┌────────────┐     ┌───────────────┐
│  React UI    │────→│  lib/tauri  │────→│  Rust Backend  │
│  (panels,    │     │  invoke()   │     │  (commands.rs) │
│   views)     │     │  dialogs    │     │  SQLite + XML  │
└──────────────┘     └────────────┘     └───────────────┘
```

Every component that needs to read from or write to game files goes through `lib/tauri.ts`. This single abstraction point means:

1. **Testability** — Can mock `invoke()` for unit tests
2. **Portability** — If the backend changes (e.g., to Electron), only this file needs updating
3. **Type safety** — Generic `invoke<T>()` ensures return types are checked at compile time
