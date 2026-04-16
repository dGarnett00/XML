# `src/` — Rust Backend Source Root

> Tauri 2 backend powering the AstraXML game-modding editor with XML parsing, SQLite persistence, and structured error logging.

## Purpose

This directory contains all Rust source code that runs as the native backend of the AstraXML desktop application. The backend handles XML file I/O, streaming parsing, SQLite persistence, document serialization, search, rule-based bulk editing, diff/snapshot tracking, schema validation, and structured error logging. The frontend (React) communicates with this backend exclusively through Tauri's IPC command system.

---

## Directory Structure

```
src/
├── main.rs         ← Windows entry point (calls lib::run())
├── lib.rs          ← Tauri builder setup, plugin registration, state management
├── commands.rs     ← 21 Tauri IPC command handlers
├── models.rs       ← All data models (serde + SQLite traits)
├── app/            ← Application-level logic (editor, search, rules, macros)
│   ├── mod.rs
│   ├── editor.rs   ← Document open/parse orchestration
│   ├── search.rs   ← Parameterized node search engine
│   ├── rules.rs    ← Bulk edit rule engine (filter + action)
│   └── macros.rs   ← Macro recording (Phase 5 stub)
└── core/           ← Low-level engines
    ├── mod.rs
    ├── xml/        ← XML parser + serializer (quick-xml)
    ├── db/         ← SQLite schema + setup (rusqlite)
    ├── diff/       ← Diff/snapshot engine
    ├── schema/     ← Schema validation
    └── error/      ← Structured error system + log store
```

---

## File Breakdown

### `main.rs` (6 lines)

Windows subsystem entry point. Uses `#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]` to hide the console window in release builds. Simply calls `astraxml_lib::run()`.

### `lib.rs` (47 lines)

Tauri application builder and initialization:

1. **SQLite initialization** — Opens an in-memory SQLite connection, runs schema setup (`db::setup::init_db`)
2. **Plugin registration** — Registers `tauri-plugin-opener`, `tauri-plugin-dialog`, `tauri-plugin-fs`
3. **State management** — Creates and manages:
   - `DbState(Mutex<Connection>)` — Thread-safe database access
   - `LogState` — Structured error log with session ID
4. **Command registration** — Registers all 21 command handlers from `commands.rs`

### `commands.rs` (726 lines)

All 21 Tauri IPC command handlers. This is the API surface between the React frontend and the Rust backend.

| Command | Category | Description |
|---------|----------|-------------|
| `open_document` | Document | Parse XML file → store in SQLite → return nodes + attributes |
| `export_document` | Document | Serialize + write modified XML to file path |
| `serialize_document` | Document | Re-serialize XML string from SQLite data (for Raw view) |
| `get_nodes` | Query | Retrieve all nodes for a document |
| `add_node` | Mutation | Insert a new child element |
| `update_node` | Mutation | Update node name/value |
| `clone_node` | Mutation | Deep BFS clone with all children and attributes |
| `delete_node` | Mutation | Recursive BFS delete of node and descendants |
| `get_attributes` | Query | Get attributes for a specific node |
| `set_attribute` | Mutation | Create or update an attribute |
| `set_child_value` | Mutation | Set the text value of a child element |
| `search_nodes` | Search | Full-text search across names, values, attributes |
| `preview_rule` | Rules | Dry-run a bulk edit rule (returns count) |
| `apply_rule` | Rules | Execute a bulk edit rule transactionally |
| `list_snapshots` | History | List all edit snapshots for a document |
| `validate_document` | Validation | Run well-formedness checks |
| `get_error_log` | Diagnostics | Retrieve error log entries |
| `clear_error_log` | Diagnostics | Clear all log entries |
| `export_error_log` | Diagnostics | Export log as JSON |
| `log_ui_error` | Diagnostics | Log a frontend-originated error |
| `get_session_id` | Diagnostics | Get current session UUID |

Every command integrates with the structured log system — operations are traced, timed, and logged via `log::push_str()` / `log::push_event()` / `log::push_err()`.

### `models.rs` (149 lines)

All data structures with `serde::Serialize`/`Deserialize` and `rusqlite::FromRow`:

| Model | Fields | Game Context |
|-------|--------|--------------|
| `Document` | id, name, path, root_node_id | The loaded `.xml` file |
| `XmlNode` | id, doc_id, parent_id, node_type, name, value, depth, order_index | Each XML element/text/comment |
| `Attribute` | id, node_id, name, value | XML attributes like `name="M4A1"` |
| `Tag` | id, doc_id, name | Document-level tags |
| `EditSnapshot` | id, doc_id, timestamp, label, patch_data | Diff snapshot for undo |
| `Preset` | id, name, preset_type, data | Saved configurations |
| `Macro` | id, name, steps | Recorded editing macro |
| `Schema` | id, name, schema_type, content | XSD/DTD schema |
| `IndexEntry` | id, doc_id, node_id, key, value | Search index entries |

Enums:
- `NodeType` — `Element`, `Attribute`, `Text`, `Comment` with custom `FromSql`/`ToSql`
- `PresetType` — `Template`, `Filter`, `Style`
- `SchemaType` — `Xsd`, `Dtd`, `Custom`

---

## Architecture Layers

```
┌──────────────────────────────────────────────┐
│                commands.rs                    │  ← API layer (Tauri IPC)
├──────────────────────────────────────────────┤
│     app/editor    app/search    app/rules    │  ← Application logic
├──────────────────────────────────────────────┤
│  core/xml   core/db   core/diff   core/error │  ← Core engines
└──────────────────────────────────────────────┘
```

- **Commands** handle Tauri IPC, acquire state locks, delegate to app/core
- **App layer** orchestrates multi-step operations (open file → parse → store → return)
- **Core layer** provides single-responsibility engines (parse XML, manage DB, compute diffs)

---

## Game Modding Context

The Rust backend is the engine that makes XML editing safe and reliable for game modders:

- **Streaming parser** — Handles massive game config files (10,000+ nodes) without loading entire XML into memory
- **SQLite persistence** — Changes are stored in a database, enabling undo/redo and diff tracking
- **Transactional edits** — Bulk edit rules run in SQL transactions — if anything fails, all changes roll back
- **Safe serialization** — XML entity escaping prevents data corruption when writing back to game files
- **Structured logging** — Every operation is logged with severity, timing, and trace correlation for debugging
