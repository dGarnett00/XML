# `core/` — Low-Level Engines

> Single-responsibility engine modules: XML processing, database management, diff tracking, schema validation, and error handling.

## Purpose

The `core/` directory contains the foundational engines that the application layer (`app/`) builds upon. Each sub-module handles exactly one concern and exposes a clean API. No core module depends on Tauri or application-level logic — they are pure Rust libraries that could theoretically be used outside of AstraXML.

---

## Directory Structure

```
core/
├── mod.rs              ← Module declarations
├── xml/                ← XML streaming parser + serializer (quick-xml)
│   ├── mod.rs
│   ├── parser.rs       ← Stream-parse XML → flat node/attribute arrays
│   └── serializer.rs   ← Flat data → formatted XML string
├── db/                 ← SQLite database schema and initialization
│   ├── mod.rs
│   └── setup.rs        ← WAL mode, 10 tables, indexes
├── diff/               ← Edit snapshot and diffing
│   ├── mod.rs
│   └── snapshot.rs     ← Line-based diff computation + storage
├── schema/             ← XML validation
│   ├── mod.rs
│   └── validate.rs     ← Well-formedness checks (XSD/DTD deferred)
└── error/              ← Structured error system
    ├── mod.rs          ← AppError enum, Severity, Category
    └── log.rs          ← LogStore ring-buffer, SQLite persistence, Tauri IPC emission
```

---

## Module Overview

| Module | Crate | Lines | Responsibility |
|--------|-------|-------|----------------|
| `xml/parser` | `quick-xml 0.36` | 205 | Streaming XML parse → flat arrays |
| `xml/serializer` | — | 116 | Flat arrays → formatted XML string |
| `db/setup` | `rusqlite 0.31` | 134 | SQLite schema (10 tables, WAL mode) |
| `diff/snapshot` | — | 93 | Line-based diff + snapshot storage |
| `schema/validate` | — | 47 | Well-formedness checks |
| `error/mod` | `thiserror` | 182 | Error types with severity/category |
| `error/log` | — | 621 | Ring-buffer log, SQL persistence, IPC emit |

---

## Data Flow Through Core

```
Game XML File
     │
     ▼
┌──────────────┐
│  xml/parser  │ ── streaming parse ──→ Vec<XmlNode> + Vec<Attribute>
└──────────────┘
     │
     ▼
┌──────────────┐
│  db/setup    │ ── tables ready ──→ SQLite stores all nodes
└──────────────┘
     │
     ▼  (user makes edits)
┌──────────────┐
│ diff/snapshot│ ── before/after diff ──→ edit_snapshots table
└──────────────┘
     │
     ▼  (user exports)
┌──────────────────┐
│  xml/serializer  │ ── flat data ──→ formatted XML string
└──────────────────┘
     │
     ▼
Modified Game XML File

Throughout all operations:
┌──────────────────┐
│    error/log     │ ── logs every operation with severity, timing, traces
└──────────────────┘
```

---

## Game Modding Context

Each core module addresses a specific challenge of game config editing:

- **xml/parser** — Handles malformed XML that game modders often create, with clear error messages pointing to the exact issue
- **xml/serializer** — Ensures round-trip safety: open a game file, edit it, save it back with identical formatting (proper indentation, entity escaping)
- **db/setup** — The 10-table schema mirrors game XML structure, enabling fast queries across thousands of items
- **diff/snapshot** — Tracks every edit so modders can undo changes and compare versions
- **schema/validate** — Catches common issues (empty element names, invalid characters) before modders export broken configs
- **error/log** — When a 10,000-line `types.xml` fails to parse, the structured log tells the modder exactly what went wrong, where, and why

See each sub-directory's README for detailed implementation documentation.
