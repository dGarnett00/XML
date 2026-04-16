# `src/` — Frontend Source Root

> React 19 + TypeScript 5.8 frontend for the AstraXML game-modding editor.

## Purpose

This directory contains all client-side code that renders the desktop UI for editing game XML files (DayZ `types.xml`, `cfgspawnabletypes.xml`, trader configs, etc.). The frontend communicates with the Rust backend via Tauri's IPC bridge to parse, validate, mutate, and serialize XML documents while providing a modern, responsive editing experience tailored for game modders.

---

## Directory Structure

```
src/
├── main.tsx            ← React entry point (StrictMode bootstrap)
├── App.tsx             ← Root component — layout shell, drag-and-drop, view routing
├── App.css             ← Root layout styles (flexbox app shell)
├── vite-env.d.ts       ← Vite type declarations
├── assets/             ← Static assets (images, logos)
├── hooks/              ← Custom React hooks (error capture)
├── lib/                ← Utility wrappers (Tauri API abstraction)
├── panels/             ← UI shell components (Toolbar, FilterBar, DetailPanel, StatusBar, ErrorLogPanel)
├── store/              ← Zustand state management (app state + error log)
├── theme/              ← Global neon-dark CSS theme (custom properties, reset)
└── views/              ← Main content views (TableView, TreeView, RawView)
```

---

## File Breakdown

### `main.tsx`

The application bootstrap. Wraps `<App />` in React's `StrictMode` and mounts it to the `#root` DOM element. Imports the global theme CSS from `theme/index.css`.

### `App.tsx`

The root component orchestrating the entire editor layout:

- **Drag-and-drop**: Handles `onDragOver` / `onDrop` events so game modders can drag XML files directly onto the window to open them.
- **View routing**: Switches between `TableView`, `TreeView`, and `RawView` based on the current `viewMode` from the Zustand store.
- **Panel layout**: Renders `Toolbar` (top), `FilterBar` (below toolbar), `StatusBar` (bottom), `DetailPanel` (right sidebar), and `ErrorLogPanel` (bottom dock) in a flexbox shell.
- **Error capture**: Calls `useErrorLog()` on mount to wire up global error/event listeners.

### `App.css`

Minimal flexbox layout establishing:
- Full-viewport `#root` and `.app` containers (`height: 100vh`)
- `.app__body` — horizontal flex split (main content + detail panel)
- `.app__main` — vertical flex column taking remaining space

---

## Data Flow (Game Modding Workflow)

```
┌─────────────────────────────────────────────────────────┐
│  User drags types.xml onto window                       │
│           ↓                                             │
│  App.tsx onDrop → store.loadDocument(filePath)          │
│           ↓                                             │
│  Tauri IPC → Rust parses XML → SQLite stores nodes      │
│           ↓                                             │
│  Store updates → Views re-render with parsed nodes      │
│           ↓                                             │
│  User edits values in TableView / TreeView              │
│           ↓                                             │
│  Mutations → Tauri IPC → Rust updates SQLite            │
│           ↓                                             │
│  Export → Rust serializes → writes modified XML file    │
└─────────────────────────────────────────────────────────┘
```

This architecture ensures that every edit to a game config file is persisted in SQLite, enabling undo/redo via snapshots, diff tracking, and safe round-trip serialization back to valid XML.

---

## Key Patterns

| Pattern | Implementation | Game Modding Benefit |
|---------|---------------|---------------------|
| **Zustand stores** | `store/app.ts`, `store/errorLog.ts` | Instant UI updates when editing item spawn rates |
| **Tauri IPC** | `lib/tauri.ts` wraps `invoke()` | Native file access for reading/writing game files |
| **CSS custom properties** | `theme/index.css` | Consistent neon-dark theme across all panels |
| **Component composition** | Panels + Views pattern | Each view optimized for different editing tasks |

---

## How It Fits Into the Game Editor

The frontend is the primary interface game modders interact with. When a modder opens a DayZ `types.xml` file:

1. **Toolbar** — Shows the file name, provides search, and view mode switching
2. **TableView** — The workhorse: spreadsheet-like editing of item types, spawn rates, categories
3. **TreeView** — Hierarchical exploration of nested XML structures
4. **RawView** — Direct XML viewing with syntax highlighting for verification
5. **DetailPanel** — Edits individual node properties (item names, attributes, child values)
6. **FilterBar** — Filters nodes by tag name, attribute, or value (e.g., find all items with `category name="weapons"`)
7. **StatusBar** — Node counts, selection info, loading state
8. **ErrorLogPanel** — Catches and displays parsing errors, validation issues, failed operations
