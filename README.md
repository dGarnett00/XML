<!-- ═══════════════════════════════════════════════════════════════════════
     A S T R A X M L
     The last XML editor you'll ever need.
     ═══════════════════════════════════════════════════════════════════════ -->

<div align="center">

```
     ___   ___________  ___  _  ____  _____    
    / _ | / __/_  __/ |/ / || |/ /  |/  / /    
   / __ |_\ \  / / /    /| || / /|_/ / /     
  /_/ |_/___/ /_/ /_/|_/ |___/_/  /_/_/____/   
```

### *The last XML editor you'll ever need.*

[![Version](https://img.shields.io/badge/v0.1.0-neon--blue?style=for-the-badge&labelColor=0d1117&color=00d4ff)](https://github.com/dGarnett00/XML/releases)
[![Platform](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-neon--purple?style=for-the-badge&labelColor=0d1117&color=a855f7)](https://tauri.app/)
[![License](https://img.shields.io/badge/MIT-neon--green?style=for-the-badge&labelColor=0d1117&color=22c55e)](LICENSE)
[![Rust](https://img.shields.io/badge/Rust%202021-neon--orange?style=for-the-badge&labelColor=0d1117&color=f97316)](https://www.rust-lang.org/)
[![TypeScript](https://img.shields.io/badge/TS%205.8-neon--cyan?style=for-the-badge&labelColor=0d1117&color=06b6d4)](https://www.typescriptlang.org/)

**Offline-first** · **Millions of nodes** · **Zero telemetry** · **Sub-200ms search**

<br/>

[Quick Start](#-quick-start) · [Features](#-features) · [Architecture](#-architecture) · [Commands](#-tauri-ipc-commands) · [Roadmap](#-roadmap)

---

</div>

## Why AstraXML?

Most XML editors choke on large files, require cloud accounts, or haven't been updated since 2014. AstraXML is different:

| Problem | AstraXML's Answer |
|---------|-------------------|
| Editors crash on 50MB+ XML | Streaming parser — never loads the full file into memory |
| Cloud-only, requires login | 100% offline. **Zero** network calls. Your data stays on your machine. |
| Can't bulk-edit 10,000 nodes | Declarative rule engine with preview-before-commit |
| No version history | Every edit creates a diffable snapshot automatically |
| Ugly, outdated UIs | Neon-dark theme with animated diagnostics and sparkline charts |

---

## ⚡ Quick Start

### One command

```bash
# Windows — double-click or run:
scripts\run.bat

# macOS / Linux
bash scripts/run.sh
```

### Manual

```bash
cd astraxml
npm install
npm run tauri dev      # opens at localhost:1420 with hot reload
```

### Prerequisites

| Tool | Version | Why |
|------|---------|-----|
| [Node.js](https://nodejs.org/) | 18+ | Frontend build |
| [Rust](https://rustup.rs/) | 1.70+ | Backend compilation |
| [VS C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) | Latest | Windows only — native compilation |
| [WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) | Latest | Windows only — rendering engine |

---

## 🔥 Features

<table>
<tr>
<td width="50%">

### Three Synchronized Views
Switch instantly between **Table** (sortable, grouped rows with inline editing), **Tree** (expand/collapse hierarchy), and **Raw XML** (syntax-highlighted source with line numbers).

### Bulk Editing Engine
Write IF/THEN rules with 5 filter conditions and 5 action types. Preview exactly which nodes are affected. Execute transactionally — all-or-nothing with automatic snapshot.

### Full-Text Search
Searches node names, values, and attributes simultaneously. Indexed for **sub-200ms** on 100K+ nodes. Supports Contains, Equals, and Regex modes.

</td>
<td width="50%">

### Structured Error Log (v2)
5,000-entry ring-buffer with trace correlation, fingerprint deduplication, breadcrumb trails, and 4-tab views (List · Timeline · Grouped · Stats). Includes real-time error-rate sparklines and severity bar charts.

### Edit Snapshots
Every mutation is versioned with a diff blob and human-readable summary. Full history per document. Crash recovery via WAL-mode SQLite.

### Drag & Drop
Drop any `.xml` file into the window. AstraXML streams it, indexes it, and renders it — no file-size dialogs, no "are you sure" prompts.

</td>
</tr>
</table>

<details>
<summary><strong>Full feature list</strong></summary>

#### Editor
- Inline editing — double-click any cell, attribute, or node name
- Detail panel — inspect selected nodes with full attribute lists and CRUD actions (add, clone, delete)
- Keyboard shortcuts — `Ctrl+L` toggle log, `Ctrl+K` clear log

#### Search & Filtering
- Filter builder — tag, attribute, and value filters
- Severity & category filtering in the error log
- Trace ID filtering — click any trace to see all correlated entries

#### Data Integrity
- Schema validation — well-formedness checks (XSD/DTD engine planned)
- Transactional rule execution with rollback
- WAL-mode SQLite with atomic saves

#### Error Log v2
- Trace correlation (`traceId` / `spanId`)
- Fingerprint grouping — auto-collapse repeated errors
- Performance timing with duration badges
- Breadcrumb trails — action history context
- Tag-based filtering
- Export as plaintext, Markdown, or JSON
- Pin entries for investigation
- Rate tracking with burst detection

#### UI
- Neon-dark theme via CSS custom properties
- Drag-to-resize error log panel
- Status bar — live node count, selection info, loading state, error badge
- Auto-scroll with toggle
- Animated pulse on new fatal/error entries

</details>

---

## 🏗 Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                         UI  (React 19 + Zustand 5)                   │
│                                                                      │
│    ┌───────────┐    ┌───────────┐    ┌───────────┐                   │
│    │ TableView │    │ TreeView  │    │  RawView  │                   │
│    └─────┬─────┘    └─────┬─────┘    └─────┬─────┘                   │
│          │                │                │                          │
│    ┌─────┴────────────────┴────────────────┴─────┐   ┌────────────┐  │
│    │          Zustand Stores                     │   │   Panels   │  │
│    │   app.ts (doc/nodes/attrs/filter)           │   │  Toolbar   │  │
│    │   errorLog.ts (ring-buffer/trace/group)     │   │  Filter    │  │
│    └──────────────────┬──────────────────────────┘   │  Detail    │  │
│                       │                              │  ErrorLog  │  │
│                       │  invoke() / listen()         │  Status    │  │
├───────────────────────┼──────────────────────────────┴────────────┤  │
│                  Tauri IPC Bridge  (21 commands)                  │  │
├───────────────────────┼──────────────────────────────────────────┤  │
│                  Application Layer  (Rust)                        │
│                       │                                           │
│    ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐            │
│    │ Editor  │  │ Search  │  │  Rules  │  │ Macros  │            │
│    └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘            │
│         │            │            │            │                  │
│    ┌────┴────────────┴────────────┴────────────┴────┐             │
│    │                 Core Layer                      │             │
│    │                                                 │             │
│    │   xml/         db/          diff/       error/  │             │
│    │   ├ parser     ├ setup      └ snapshot   └ log  │             │
│    │   └ serializer └ mod                            │             │
│    │                                  schema/        │             │
│    │                                  └ validate     │             │
│    └────────────────────┬────────────────────────────┘             │
│                         │                                         │
│                   ┌─────┴─────┐                                   │
│                   │  SQLite   │                                   │
│                   │ WAL mode  │                                   │
│                   │ 10 tables │                                   │
│                   └───────────┘                                   │
└───────────────────────────────────────────────────────────────────┘
```

### Data Flow

```
User action  →  React component  →  Zustand store  →  Tauri invoke()
     ↑                                                       │
     │              Rust command  →  Core module  →  SQLite   │
     └───────────────── response ─────────────────────────────┘
```

---

## 🧬 Tech Stack

<table>
<tr><th>Layer</th><th>Technology</th><th>Version</th><th>Role</th></tr>
<tr><td rowspan="4"><strong>Frontend</strong></td>
    <td>React</td><td>19.1</td><td>Component rendering</td></tr>
<tr><td>Zustand</td><td>5.0</td><td>State management (2 stores)</td></tr>
<tr><td>TypeScript</td><td>5.8</td><td>Type safety</td></tr>
<tr><td>Vite</td><td>7.0</td><td>Build + HMR</td></tr>
<tr><td rowspan="5"><strong>Backend</strong></td>
    <td>Rust</td><td>2021 ed.</td><td>Performance-critical core</td></tr>
<tr><td>Tauri</td><td>2.x</td><td>Desktop shell + IPC</td></tr>
<tr><td>quick-xml</td><td>0.36</td><td>Streaming XML parser</td></tr>
<tr><td>rusqlite</td><td>0.31</td><td>SQLite (bundled, zero config)</td></tr>
<tr><td>thiserror</td><td>1.x</td><td>Typed error propagation</td></tr>
<tr><td rowspan="3"><strong>Infra</strong></td>
    <td>GitHub Actions</td><td>—</td><td>CI/CD → cross-platform installers</td></tr>
<tr><td>tauri-plugin-dialog</td><td>2.x</td><td>Native file open/save dialogs</td></tr>
<tr><td>tauri-plugin-fs</td><td>2.x</td><td>Filesystem access</td></tr>
</table>

---

## 📂 Project Structure

```
XML/
│
├── astraxml/                          # ── The Application ──────────────
│   ├── src/                           #    Frontend (React + TypeScript)
│   │   ├── App.tsx                    #    Root layout: views + panels + drag-drop
│   │   ├── main.tsx                   #    React 19 entry
│   │   ├── hooks/
│   │   │   └── useErrorLog.ts         #    IPC bridge + window.onerror capture
│   │   ├── lib/
│   │   │   └── tauri.ts               #    invoke() wrapper, isTauri() detection
│   │   ├── panels/
│   │   │   ├── Toolbar.tsx            #    Open / Save / Export / View switcher
│   │   │   ├── FilterBar.tsx          #    Tag / Attribute / Value filters
│   │   │   ├── DetailPanel.tsx        #    Node inspector + CRUD actions
│   │   │   ├── ErrorLogPanel.tsx      #    4-tab log viewer + sparklines
│   │   │   └── StatusBar.tsx          #    Node count, selection, errors
│   │   ├── store/
│   │   │   ├── app.ts                 #    Document, nodes, filters, view mode
│   │   │   └── errorLog.ts            #    Ring-buffer, trace, fingerprint, rate
│   │   ├── theme/
│   │   │   └── index.css              #    Neon-dark CSS variables + globals
│   │   └── views/
│   │       ├── TableView.tsx          #    Sortable grouped table
│   │       ├── TreeView.tsx           #    Collapsible tree hierarchy
│   │       └── RawView.tsx            #    Syntax-highlighted XML source
│   │
│   ├── src-tauri/                     #    Backend (Rust)
│   │   ├── src/
│   │   │   ├── main.rs               #    Tauri bootstrap
│   │   │   ├── lib.rs                 #    Plugin registration + state
│   │   │   ├── commands.rs            #    21 IPC command handlers
│   │   │   ├── models.rs              #    Serde structs (Document, XmlNode…)
│   │   │   ├── app/
│   │   │   │   ├── editor.rs          #    Document open/persist
│   │   │   │   ├── search.rs          #    LIKE-based full-text search
│   │   │   │   ├── rules.rs           #    IF/THEN bulk edit engine
│   │   │   │   └── macros.rs          #    Macro recording + playback
│   │   │   └── core/
│   │   │       ├── xml/
│   │   │       │   ├── parser.rs      #    Streaming quick-xml parser
│   │   │       │   └── serializer.rs  #    XML reconstruction + indentation
│   │   │       ├── db/
│   │   │       │   └── setup.rs       #    10-table schema + WAL pragmas
│   │   │       ├── diff/
│   │   │       │   └── snapshot.rs    #    Edit versioning + diff blobs
│   │   │       ├── schema/
│   │   │       │   └── validate.rs    #    Validation (XSD/DTD planned)
│   │   │       └── error/
│   │   │           └── log.rs         #    Ring-buffer logger + IPC emit
│   │   ├── Cargo.toml                 #    Rust dependencies
│   │   └── tauri.conf.json            #    Window / bundle / CSP config
│   │
│   ├── package.json                   #    npm scripts + JS dependencies
│   ├── vite.config.ts                 #    Vite build config
│   └── tsconfig.json                  #    TypeScript config (strict)
│
├── docs/                              # ── Design Documents ─────────────
│   ├── plan.txt                       #    7-phase roadmap + principles
│   ├── Roadmap.txt                    #    Gantt chart + wireframes
│   ├── Engineering Task Breakdown.txt #    14 sprints × 2 weeks
│   └── roadmap.svg                    #    Visual Gantt (neon-dark)
│
├── scripts/                           # ── Dev Scripts ──────────────────
│   ├── run.bat                        #    Windows one-click launcher
│   └── run.sh                         #    macOS / Linux launcher
│
├── .github/
│   └── workflows/
│       └── release.yml                #    CI/CD: cross-platform installers
│
├── .gitignore
└── README.md                          #    ← You are here
```

---

## 🗄 Data Model

```
  Document ─────1:N─────── XmlNode ──────1:N──── Attribute
  │                        │
  │                        └──1:N──── Tag
  │
  ├──1:N──── EditSnapshot
  └──1:1──── Schema

  ─────────────────────────────────────────────
  Standalone:   Preset  ·  Macro  ·  IndexEntry
```

<details>
<summary><strong>Full schema (10 tables)</strong></summary>

| Table | Key Columns | Purpose |
|-------|-------------|---------|
| `documents` | id, path, display_name, xml_version, encoding, root_node_id, schema_id | Document metadata |
| `xml_nodes` | id, document_id, parent_id, node_type, name, value, order_index, depth | Flat tree storage |
| `attributes` | id, node_id, name, value | Key-value pairs per node |
| `tags` | id, document_id, node_id, name | User-defined tags |
| `edit_snapshots` | id, document_id, diff_blob, summary, created_at | Version history |
| `schemas` | id, document_id, schema_type, raw_schema | XSD/DTD/Inferred schemas |
| `error_log` | id, session_id, severity, category, source, message, trace_id, fingerprint, seq | Structured event log |
| `presets` | id, name, preset_type, payload | Saved filter/edit/export configs |
| `macros` | id, name, steps | Recorded action sequences |
| `index_entries` | id, document_id, node_id, name_hash, value_hash, path_string | Search acceleration |

**Config:** WAL journal · NORMAL sync · Foreign keys ON · Indexed on all FK columns + search hashes

</details>

---

## 📡 Tauri IPC Commands

<details>
<summary><strong>All 21 commands</strong></summary>

| # | Command | Description |
|---|---------|-------------|
| 1 | `open_document` | Stream-parse XML, persist to DB, return doc + nodes + attrs |
| 2 | `get_nodes` | Fetch all nodes for a document |
| 3 | `get_attributes` | Fetch all attributes for a document |
| 4 | `add_node` | Create a child node under a parent |
| 5 | `update_node` | Modify a node's name or value |
| 6 | `clone_node` | Deep-clone node + all descendants + attributes |
| 7 | `delete_node` | Cascade-delete node + children + attributes |
| 8 | `set_attribute` | Update a single attribute |
| 9 | `set_child_value` | Update child element text |
| 10 | `search_nodes` | Full-text search (names, values, attributes) |
| 11 | `preview_rule` | Dry-run a bulk edit rule |
| 12 | `apply_rule` | Execute a bulk edit rule transactionally |
| 13 | `validate_document` | Schema validation checks |
| 14 | `serialize_document` | Reconstruct XML string for Raw view |
| 15 | `export_document` | Serialize + write XML to disk |
| 16 | `list_snapshots` | List edit history for a document |
| 17 | `get_error_log` | Read ring-buffer entries |
| 18 | `clear_error_log` | Clear in-memory + persisted log |
| 19 | `export_error_log` | Dump all entries as JSON |
| 20 | `log_ui_error` | Record a frontend error in the backend |
| 21 | `get_session_id` | Get current session UUID |

</details>

---

## 🔨 Building

### Development

```bash
cd astraxml
npm run tauri dev
```

### Production

```bash
cd astraxml
npm run tauri build
```

| Platform | Output |
|----------|--------|
| Windows | `src-tauri/target/release/bundle/msi/` and `nsis/` |
| macOS | `src-tauri/target/release/bundle/dmg/` |
| Linux | `src-tauri/target/release/bundle/appimage/` and `deb/` |

### CI/CD

Tag a release → GitHub Actions builds cross-platform installers automatically:

```bash
git tag v1.0.0
git push origin v1.0.0
```

Installers appear on the [Releases](https://github.com/dGarnett00/XML/releases) page.

---

## 🗺 Roadmap

```
Phase 0  ██████████████████████  Foundation                    ✅ Done
Phase 1  ██████████░░░░░░░░░░░░  Core Editor                   🔄 Active
Phase 2  ░░░░░░░░░░░░░░░░░░░░░░  Advanced Editing              📋 Next
Phase 3  ░░░░░░░░░░░░░░░░░░░░░░  Schema Intelligence
Phase 4  ░░░░░░░░░░░░░░░░░░░░░░  Futuristic UX
Phase 5  ░░░░░░░░░░░░░░░░░░░░░░  Automation & Scripting
Phase 6  ░░░░░░░░░░░░░░░░░░░░░░  Enterprise Reliability
Phase 7  ░░░░░░░░░░░░░░░░░░░░░░  Pro Modules
```

<details>
<summary><strong>Phase details</strong></summary>

| Phase | Weeks | Highlights |
|-------|-------|------------|
| **0 — Foundation** | 1–2 | Tauri scaffold, streaming XML parser, SQLite schema, plugin architecture |
| **1 — Core Editor** | 3–6 | Table/Tree/Raw views, search indexing, filter builder, inline editing, undo/redo |
| **2 — Advanced Editing** | 7–10 | Bulk edits, rule engine, preset macros, mass rename, snapshot diffing |
| **3 — Schema Intelligence** | 11–14 | XSD/DTD validation engine, autocomplete, inline error markers, semantic grouping |
| **4 — Futuristic UX** | 15–18 | Offline LLM natural-language edits, timeline slider, command palette, neon UI polish |
| **5 — Automation** | 19–24 | Lua/JS scripting sandbox, macro recorder, export pipelines, scheduled tasks |
| **6 — Enterprise** | 25–28 | Large file optimization (100M+ nodes), partial rendering, atomic saves, file locking |
| **7 — Pro Modules** | 29–36 | XML comparison studio, dataset explorer, XML↔JSON/YAML converter, plugin marketplace |

</details>

See [`docs/`](docs/) for the full engineering task breakdown and sprint schedules.

---

## 🤝 Contributing

```bash
# 1. Fork & clone
git clone https://github.com/<you>/XML.git
cd XML/astraxml

# 2. Create a branch
git checkout -b feat/my-feature

# 3. Make changes, then commit
git commit -m "feat: add my feature"

# 4. Push & open a PR
git push origin feat/my-feature
```

### Code Style

| Language | Standard | Command |
|----------|----------|---------|
| Rust | `rustfmt` defaults | `cargo fmt` |
| TypeScript | Strict mode, no unused vars | `npx tsc --noEmit` |
| Commits | [Conventional Commits](https://www.conventionalcommits.org/) | `feat:` · `fix:` · `refactor:` |

---

## 📄 License

MIT © [dGarnett00](https://github.com/dGarnett00)

---

<div align="center">
<sub>Built with obsessive attention to performance by a developer who was tired of bad XML editors.</sub>
</div>
