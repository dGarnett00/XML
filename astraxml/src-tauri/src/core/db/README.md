# `db/` — SQLite Database Layer

> In-memory SQLite database with WAL journaling, 10 tables, and optimized indexes for fast game config editing.

## Purpose

This module initializes and configures the SQLite database that stores all parsed XML data, edit history, error logs, presets, macros, and schemas. Using SQLite instead of in-memory data structures enables SQL-powered search, transactional edits (atomic rollback), and persistent error logging. The database runs in-memory for speed but with WAL journaling mode for concurrent access.

---

## Files

### `mod.rs` (1 line)

Module declaration:
```rust
pub mod setup;
```

---

### `setup.rs` — Database Schema & Initialization (134 lines)

#### `init_db(conn: &Connection) → Result<()>`

Called once at application startup from `lib.rs`. Configures SQLite pragmas and creates all 10 tables.

#### SQLite Configuration

```sql
PRAGMA journal_mode = WAL;      -- Write-Ahead Logging for concurrent reads
PRAGMA synchronous = NORMAL;    -- Balanced durability/speed
PRAGMA foreign_keys = ON;       -- Enforce referential integrity
```

- **WAL mode** — Allows the frontend to read data while the backend writes, preventing blocking
- **NORMAL sync** — Faster than FULL, acceptable for an in-memory editing session
- **Foreign keys** — Ensures nodes reference valid documents, attributes reference valid nodes

#### Table Schema

##### 1. `documents`
```sql
CREATE TABLE documents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    root_node_id INTEGER
);
```
Stores metadata about each opened game XML file.

##### 2. `xml_nodes`
```sql
CREATE TABLE xml_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id),
    parent_id INTEGER,
    node_type TEXT NOT NULL,      -- 'element', 'attribute', 'text', 'comment'
    name TEXT,
    value TEXT,
    depth INTEGER NOT NULL DEFAULT 0,
    order_index INTEGER NOT NULL DEFAULT 0
);
```
The core table — every XML element, text node, and comment is stored as a row. For a DayZ `types.xml` with 1,000 item types, this table might have 15,000+ rows.

**Indexes:**
- `idx_nodes_doc` — Fast lookup by document ID
- `idx_nodes_parent` — Fast child retrieval (used by tree view, serializer)
- `idx_nodes_name` — Fast name-based search (find all `<nominal>` elements)

##### 3. `attributes`
```sql
CREATE TABLE attributes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    node_id INTEGER NOT NULL REFERENCES xml_nodes(id),
    name TEXT NOT NULL,
    value TEXT
);
```
XML attributes stored separately for flexible querying. `<type name="AKM">` becomes `{ node_id: 42, name: "name", value: "AKM" }`.

**Indexes:**
- `idx_attrs_node` — Get all attributes for a node
- `idx_attrs_name` — Find all attributes with a specific name

##### 4. `tags`
```sql
CREATE TABLE tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id),
    name TEXT NOT NULL
);
```
Document-level tags for organization. Not to be confused with XML `<tag>` elements.

##### 5. `edit_snapshots`
```sql
CREATE TABLE edit_snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id),
    timestamp TEXT NOT NULL,
    label TEXT,
    patch_data TEXT
);
```
Stores diff patches for undo/redo history. Each snapshot contains a line-based diff computed by the `diff/snapshot` module.

##### 6. `error_log` (v2 schema)
```sql
CREATE TABLE error_log (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    severity TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'unknown',
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT,
    trace_id TEXT,
    span_id TEXT,
    duration_ms REAL,
    fingerprint TEXT,
    tags TEXT,           -- JSON array
    breadcrumbs TEXT,    -- JSON array
    context TEXT,        -- JSON object
    seq INTEGER NOT NULL DEFAULT 0
);
```
Full structured logging with trace correlation, performance timing, and fingerprinting.

**Indexes:**
- `idx_errlog_session` — Filter by session
- `idx_errlog_severity` — Filter by severity level
- `idx_errlog_ts` — Order by timestamp
- `idx_errlog_trace` — Correlate related operations
- `idx_errlog_fp` — Group by fingerprint

##### 7. `presets`
```sql
CREATE TABLE presets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    preset_type TEXT NOT NULL,
    data TEXT
);
```
Saved editor configurations (templates, filter presets, style presets).

##### 8. `macros`
```sql
CREATE TABLE macros (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    steps TEXT           -- JSON array of macro steps
);
```
Recorded editing macros for repeatable operations.

##### 9. `schemas`
```sql
CREATE TABLE schemas (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    schema_type TEXT NOT NULL,
    content TEXT
);
```
Stored XSD/DTD schemas for validation (Phase 3).

##### 10. `index_entries`
```sql
CREATE TABLE index_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    doc_id INTEGER NOT NULL REFERENCES documents(id),
    node_id INTEGER NOT NULL REFERENCES xml_nodes(id),
    key TEXT NOT NULL,
    value TEXT
);
```
Search index for fast full-text lookup.

---

## Performance Characteristics

| Operation | Performance | Context |
|-----------|-------------|---------|
| Insert 15,000 nodes | ~100ms | Opening a large types.xml |
| Query by parent_id | ~1ms | Expanding a tree node |
| Query by name LIKE | ~5ms | Search across all nodes |
| Full table scan | ~10ms | Rule engine filtering |
| Transaction commit | ~1ms | After bulk edit |

The in-memory SQLite database with indexes provides database-grade query performance without disk I/O overhead.

---

## Game Modding Context

The 10-table schema mirrors the structure of game modding workflows:

- `documents` + `xml_nodes` + `attributes` = the game config data model
- `edit_snapshots` = undo/redo for safe experimentation with values
- `error_log` = diagnostic trail for debugging malformed configs
- `presets` = saved filter/template configurations for common editing patterns
- `macros` = automating repetitive edits across multiple game files
- `schemas` = future XSD validation against official game schemas
