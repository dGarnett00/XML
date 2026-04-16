# `error/` — Structured Error & Logging System

> Centralized error types, severity classification, and a high-performance bounded log store with SQLite persistence and Tauri IPC emission.

## Purpose

This is the most comprehensive module in the backend. It provides:
1. A typed error enum (`AppError`) with automatic severity and category classification
2. A bounded ring-buffer log store (`LogStore`) with 5,000-entry capacity
3. SQLite persistence for permanent error history
4. Tauri IPC event emission for real-time frontend updates
5. Trace correlation, performance timing, fingerprinting, and breadcrumb trails

Every operation in the entire application — from XML parsing to database writes to rule execution — flows through this error system.

---

## Files

### `mod.rs` — Error Types & Classification (182 lines)

#### `Severity` Enum

```rust
pub enum Severity {
    Debug,    // Detailed diagnostic info
    Info,     // Normal operation events
    Warn,     // Unexpected but recoverable situations
    Error,    // Operation failures
    Fatal,    // Unrecoverable failures
}
```

Ordered via `PartialOrd` — `Debug < Info < Warn < Error < Fatal`. This ordering is used for:
- Filtering (show only errors ≥ Warn)
- Grouped view (group takes highest severity)
- Pulse animation (only Error/Fatal trigger header pulse)

#### `Category` Enum

```rust
pub enum Category {
    Parse,          // XML parsing issues
    Db,             // SQLite database errors
    Io,             // File system I/O errors
    Validation,     // Schema/well-formedness issues
    Rule,           // Bulk edit rule errors
    Snapshot,       // Diff/snapshot errors
    Serialization,  // XML serialization issues
    Command,        // Tauri IPC command failures
    Ui,             // Frontend-originated errors
    Unknown,        // Uncategorized
}
```

#### `AppError` Enum (thiserror-derived)

Every error variant has a canonical severity and category:

| Variant | Severity | Category | Source |
|---------|----------|----------|--------|
| `ParseError(String)` | Error | Parse | `quick_xml::Error` |
| `DatabaseError(String)` | Error | Db | `rusqlite::Error` |
| `IoError(String)` | Error | Io | `std::io::Error` |
| `ValidationError(String)` | Warn | Validation | Schema checks |
| `SerializationError(String)` | Error | Serialization | `serde_json::Error` |
| `NotFound(String)` | Warn | Command | 404-like lookups |
| `InvalidInput(String)` | Warn | Command | Bad user input |
| `Internal(String)` | Fatal | Unknown | Catch-all |

#### Automatic Conversions (`From` impls)

```rust
impl From<rusqlite::Error> for AppError    → DatabaseError
impl From<std::io::Error> for AppError     → IoError
impl From<quick_xml::Error> for AppError   → ParseError
impl From<serde_json::Error> for AppError  → SerializationError
impl From<String> for AppError             → Internal
```

This means any function returning `Result<T, AppError>` can use `?` to propagate errors from any of these crate types, and they'll automatically be classified with the correct severity and category.

---

### `log.rs` — Log Store & Infrastructure (621 lines)

The largest file in the entire backend. Implements a production-grade structured logging system.

#### `LogEntry` — Full v2 Schema

```rust
pub struct LogEntry {
    pub id: String,           // UUID v4
    pub session_id: String,   // Session UUID (correlates app lifetime)
    pub timestamp: String,    // ISO 8601
    pub severity: String,     // fatal/error/warn/info/debug
    pub category: String,     // parse/db/io/validation/rule/...
    pub source: String,       // Component that generated the entry
    pub message: String,      // Human-readable message
    pub detail: Option<String>,       // Stack trace or extended info
    pub trace_id: Option<String>,     // Distributed trace correlation
    pub span_id: Option<String>,      // Span within a trace
    pub duration_ms: Option<f64>,     // Performance timing
    pub fingerprint: Option<String>,  // FNV hash for deduplication
    pub tags: Vec<String>,            // Freeform tags
    pub breadcrumbs: Vec<Breadcrumb>, // Action history trail
    pub context: HashMap<String, String>, // Key-value metadata
    pub seq: u64,                     // Monotonic sequence number
}
```

#### `LogStore` — Bounded Ring-Buffer

```rust
pub struct LogStore {
    entries: Vec<LogEntry>,       // max 5,000 entries
    breadcrumbs: Vec<Breadcrumb>, // max 25 breadcrumbs
    seq: u64,                     // monotonic counter
}
```

**Ring-buffer behavior:** When the 5,001st entry is pushed, the oldest entry is dropped. This prevents unbounded memory growth during long editing sessions.

**Methods:**
| Method | Description |
|--------|-------------|
| `push(entry)` | Add entry, enforce 5,000 cap |
| `entries()` | Get all entries |
| `query(severity?, category?)` | Filter entries |
| `count_by_severity(sev)` | Count entries at a severity level |
| `clear()` | Remove all entries |
| `add_breadcrumb(label, data?)` | Record an action for breadcrumb trail |
| `next_seq()` | Get next monotonic sequence number |

#### `LogState` — Tauri-Managed Wrapper

```rust
pub struct LogState {
    pub store: Arc<Mutex<LogStore>>,
    pub session_id: String,
}
```

Wrapped in `Arc<Mutex<>>` for thread-safe access from any Tauri command handler.

#### Push Functions — Triple-Sink Architecture

Every log entry is written to **three destinations simultaneously**:

```
log::push() called
     │
     ├──→ 1. SQLite: persist() INSERT into error_log table
     │
     ├──→ 2. Tauri IPC: app.emit("error:log", &entry)
     │        → Frontend receives in useErrorLog hook
     │        → Error Log Panel updates in real-time
     │
     └──→ 3. Ring-buffer: store.push(entry)
              → In-memory for fast query access
```

**Convenience push functions:**

| Function | Usage |
|----------|-------|
| `push(entry, state, conn, app)` | Full structured entry |
| `push_str(source, message, severity, category, ...)` | Quick string-based log |
| `push_err(error: &AppError, source, ...)` | Log from an AppError |
| `push_event(source, message, ...)` | Info-level event log |

#### SQLite Persistence — `persist()`

```sql
INSERT INTO error_log (
    id, session_id, timestamp, severity, category,
    source, message, detail, trace_id, span_id,
    duration_ms, fingerprint, tags, breadcrumbs, context, seq
) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)
```

- `tags` → serialized as JSON array
- `breadcrumbs` → serialized as JSON array
- `context` → serialized as JSON object
- **Infallible**: Errors from `persist()` are silently swallowed — the log system never crashes the app

#### Database Query — `query_db()`

```sql
SELECT * FROM error_log
WHERE session_id = ?1
  [AND severity = ?2]
  [AND category = ?3]
ORDER BY timestamp ASC
```

Dynamically builds the WHERE clause based on provided filters.

#### `clear_db()`

```sql
DELETE FROM error_log WHERE session_id = ?1
```

Clears all entries for the current session.

---

## Error Flow Through the Application

```
1. User opens malformed types.xml
     │
     ▼
2. xml/parser encounters invalid XML
     │
     ▼
3. quick_xml::Error propagated
     │
     ▼
4. From<quick_xml::Error> → AppError::ParseError
     │
     ▼
5. commands.rs catches error, calls log::push_err()
     │
     ▼
6. Triple-sink: SQLite + Tauri IPC + Ring-buffer
     │
     ▼
7. Frontend useErrorLog hook receives "error:log" event
     │
     ▼
8. Error Log Panel displays with:
   - 🔴 ERR severity badge
   - "parse" category label
   - Error message with file location
   - Expandable stack trace
   - Trace ID linking to the open_document operation
```

---

## Game Modding Context

Game modders frequently encounter these error categories:

| Category | Common Cause | Example |
|----------|-------------|---------|
| **Parse** | Malformed XML from manual editing | Missing `</type>` closing tag |
| **Validation** | Invalid values | `nominal` set to negative number |
| **Io** | File permission issues | Server config is read-only |
| **Rule** | Bulk edit filter matches nothing | Filter for non-existent attribute |
| **Command** | Invalid operation | Delete node that doesn't exist |

The structured log system turns cryptic Rust errors into actionable information:
- **Before**: `"Error: invalid token at position 4523"`
- **After**: `[ERR] [parse] types.xml:142 — Unexpected token '</' — expected closing tag for <type>`

With trace correlation, all errors from a single file-open attempt share the same `traceId`, so the modder can see the full picture of what went wrong.
