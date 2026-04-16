//! AstraXML — Structured in-process error and event log.
//!
//! Architecture
//! ────────────
//! ┌──────────┐   push()   ┌──────────────────────────────────────────┐
//! │ Any code │ ─────────► │ LogStore  (bounded ring-buffer, 5 000)   │
//! └──────────┘            │   • in-memory  VecDeque<LogEntry>        │
//!                         │   • SQLite     error_log table            │
//!                         │   • Tauri IPC  "error:log" event          │
//!                         └──────────────────────────────────────────┘
//!
//! Key design choices
//! ──────────────────
//! • **Infallible push** — DB writes and event emissions are fire-and-forget.
//!   A failure in the logging layer must *never* propagate to the caller.
//! • **Bounded memory** — the ring-buffer evicts the oldest entry once full.
//!   Historical data is preserved in SQLite for the full session lifetime.
//! • **Typed metadata** — every entry carries Severity + Category so the UI
//!   can filter without string parsing.
//! • **Separate concerns** — `LogStore` owns memory, `persist` owns DB,
//!   `push` orchestrates all three sinks.
//! • **Trace correlation** — every entry can carry a `trace_id` / `span_id`
//!   so related events (e.g. one open_document flow) can be grouped.
//! • **Performance timing** — optional `duration_ms` for profiling operations.
//! • **Fingerprinting** — a hash of (category + source + message-template)
//!   lets the UI group/deduplicate repeated events automatically.
//! • **Breadcrumbs** — lightweight trail of recent actions for richer context.
//! • **Tags** — flexible string tags for custom grouping and filtering.

use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, VecDeque};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Mutex};

use chrono::Utc;
use rusqlite::{named_params, Connection};
use serde::{Deserialize, Serialize};
use tauri::Emitter;
use uuid::Uuid;

use super::{AppError, Category, Severity};

/// Maximum entries kept in the in-memory ring-buffer.
/// Older entries are dropped from memory but remain in SQLite.
pub const MAX_RING_ENTRIES: usize = 5_000;

// ── Breadcrumb ────────────────────────────────────────────────────────────

/// A lightweight trail entry recording a recent user/system action.
/// Breadcrumbs are attached to log entries to provide a richer context trail
/// that shows what happened leading up to an event.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Breadcrumb {
    /// ISO-8601 timestamp.
    pub timestamp: String,
    /// Short label, e.g. "file.open", "rule.apply", "ui.click".
    pub label: String,
    /// Optional extra data (e.g. file path, rule name).
    pub data: Option<String>,
}

// ── LogEntry ─────────────────────────────────────────────────────────────

/// A single, immutable log event.
///
/// The schema mirrors the TypeScript `LogEntry` interface (camelCase via serde)
/// so it serialises transparently over the Tauri IPC bridge.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    /// Unique identifier for this event (UUIDv4).
    pub id: String,

    /// Session ID — all entries within one app run share this UUID.
    pub session_id: String,

    /// ISO-8601 timestamp with millisecond precision.
    pub timestamp: String,

    /// Severity level.
    pub severity: Severity,

    /// Subsystem category.
    pub category: Category,

    /// Human-readable source location, e.g. `"editor::open_document"`.
    pub source: String,

    /// Primary human-readable error message.
    pub message: String,

    /// Extended detail or error chain (optional).
    pub detail: Option<String>,

    /// Arbitrary key-value context set at the call-site.
    pub context: HashMap<String, String>,

    // ── New fields ────────────────────────────────────────────────────

    /// Trace ID — groups all events that belong to a single logical operation
    /// (e.g. one open→parse→load flow).  UUIDv4 or empty.
    #[serde(default)]
    pub trace_id: Option<String>,

    /// Span ID — identifies a single step within a trace.
    #[serde(default)]
    pub span_id: Option<String>,

    /// Wall-clock duration in milliseconds for timed operations.
    #[serde(default)]
    pub duration_ms: Option<f64>,

    /// Fingerprint hash for deduplication/grouping of similar events.
    /// Computed from (category, source, message_template).
    #[serde(default)]
    pub fingerprint: Option<String>,

    /// Flexible string tags for custom grouping and filtering.
    #[serde(default)]
    pub tags: Vec<String>,

    /// Breadcrumb trail — recent actions leading up to this event.
    #[serde(default)]
    pub breadcrumbs: Vec<Breadcrumb>,

    /// Monotonic sequence number within the session for guaranteed ordering.
    #[serde(default)]
    pub seq: u64,
}

impl LogEntry {
    /// Construct a new `LogEntry` stamped with the current UTC time.
    pub fn new(
        session_id: impl AsRef<str>,
        severity: Severity,
        category: Category,
        source: impl Into<String>,
        message: impl Into<String>,
        detail: Option<String>,
        context: HashMap<String, String>,
    ) -> Self {
        let src = source.into();
        let msg = message.into();
        let fp  = compute_fingerprint(&category, &src, &msg);
        Self {
            id: Uuid::new_v4().to_string(),
            session_id: session_id.as_ref().to_owned(),
            timestamp: Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            severity,
            category,
            source: src,
            message: msg,
            detail,
            context,
            trace_id: None,
            span_id: None,
            duration_ms: None,
            fingerprint: Some(fp),
            tags: Vec::new(),
            breadcrumbs: Vec::new(),
            seq: 0,
        }
    }

    /// Build a `LogEntry` directly from an `AppError`, reading its built-in
    /// severity and category so no caller annotation is needed.
    pub fn from_app_error(
        err: &AppError,
        session_id: impl AsRef<str>,
        source: impl Into<String>,
        context: HashMap<String, String>,
    ) -> Self {
        Self::new(
            session_id,
            err.severity(),
            err.category(),
            source,
            err.to_string(),
            None,
            context,
        )
    }

    /// Build a `LogEntry` from a plain `String` error returned by existing
    /// code that has not yet been migrated to `AppError`.
    /// Severity is always `Error`; category must be supplied by the caller.
    pub fn from_string_error(
        msg: impl Into<String>,
        session_id: impl AsRef<str>,
        source: impl Into<String>,
        category: Category,
        context: HashMap<String, String>,
    ) -> Self {
        Self::new(
            session_id,
            Severity::Error,
            category,
            source,
            msg,
            None,
            context,
        )
    }

    /// Builder: attach a trace ID.
    pub fn with_trace(mut self, trace_id: impl Into<String>) -> Self {
        self.trace_id = Some(trace_id.into());
        self
    }

    /// Builder: attach a span ID.
    pub fn with_span(mut self, span_id: impl Into<String>) -> Self {
        self.span_id = Some(span_id.into());
        self
    }

    /// Builder: attach timing.
    pub fn with_duration(mut self, ms: f64) -> Self {
        self.duration_ms = Some(ms);
        self
    }

    /// Builder: attach tags.
    pub fn with_tags(mut self, tags: Vec<String>) -> Self {
        self.tags = tags;
        self
    }

    /// Builder: attach breadcrumbs.
    pub fn with_breadcrumbs(mut self, crumbs: Vec<Breadcrumb>) -> Self {
        self.breadcrumbs = crumbs;
        self
    }
}

/// Compute a stable fingerprint for deduplication/grouping.
/// Uses FNV-style hashing of (category, source, first 80 chars of message).
fn compute_fingerprint(category: &Category, source: &str, message: &str) -> String {
    let mut hasher = DefaultHasher::new();
    category.to_string().hash(&mut hasher);
    source.hash(&mut hasher);
    // Truncate message to avoid hashing long stack traces
    let truncated: String = message.chars().take(80).collect();
    truncated.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

// ── LogStore ──────────────────────────────────────────────────────────────

/// Bounded in-memory ring-buffer for log entries.
///
/// Thread safety is provided by the wrapping `LogState(Arc<Mutex<LogStore>>)`.
pub struct LogStore {
    /// Unique identifier shared by all entries produced in this app session.
    pub session_id: String,
    /// Circular buffer — front is oldest, back is newest.
    entries: VecDeque<LogEntry>,
    /// Monotonically increasing counter (includes evicted entries).
    total_pushed: u64,
    /// Rolling breadcrumb trail (last N actions) attached to new entries.
    breadcrumbs: VecDeque<Breadcrumb>,
}

/// Max breadcrumbs to keep in the rolling trail.
const MAX_BREADCRUMBS: usize = 25;

impl LogStore {
    pub fn new() -> Self {
        Self {
            session_id: Uuid::new_v4().to_string(),
            entries: VecDeque::with_capacity(MAX_RING_ENTRIES),
            total_pushed: 0,
            breadcrumbs: VecDeque::with_capacity(MAX_BREADCRUMBS),
        }
    }

    /// Record a breadcrumb to the rolling trail.
    pub fn add_breadcrumb(&mut self, label: impl Into<String>, data: Option<String>) {
        if self.breadcrumbs.len() >= MAX_BREADCRUMBS {
            self.breadcrumbs.pop_front();
        }
        self.breadcrumbs.push_back(Breadcrumb {
            timestamp: Utc::now()
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            label: label.into(),
            data,
        });
    }

    /// Snapshot the current breadcrumb trail (clone).
    pub fn breadcrumbs_snapshot(&self) -> Vec<Breadcrumb> {
        self.breadcrumbs.iter().cloned().collect()
    }

    /// Push one entry into the ring-buffer, evicting the oldest if full.
    /// Automatically stamps the entry with the next sequence number and
    /// attaches the current breadcrumb trail (if the entry has none).
    pub fn push(&mut self, mut entry: LogEntry) {
        self.total_pushed += 1;
        entry.seq = self.total_pushed;

        // Auto-attach breadcrumbs to error/fatal entries when none provided.
        if entry.breadcrumbs.is_empty()
            && (entry.severity >= Severity::Error)
        {
            entry.breadcrumbs = self.breadcrumbs_snapshot();
        }

        if self.entries.len() >= MAX_RING_ENTRIES {
            self.entries.pop_front();
        }
        self.entries.push_back(entry);
    }

    /// Iterate over all buffered entries, oldest first.
    pub fn entries(&self) -> impl Iterator<Item = &LogEntry> {
        self.entries.iter()
    }

    /// Total entries ever received (including those evicted from the buffer).
    pub fn total_pushed(&self) -> u64 { self.total_pushed }

    /// Current number of entries held in memory.
    pub fn len(&self) -> usize { self.entries.len() }
    pub fn is_empty(&self) -> bool { self.entries.is_empty() }

    /// Clear the in-memory ring-buffer.  Does *not* touch the SQLite table.
    pub fn clear(&mut self) { self.entries.clear(); }

    /// Return up to `limit` entries (newest first) matching the optional filters.
    pub fn query(
        &self,
        severity: Option<Severity>,
        category: Option<Category>,
        limit: usize,
    ) -> Vec<LogEntry> {
        self.entries
            .iter()
            .rev()
            .filter(|e| {
                severity.is_none_or(|s| e.severity == s)
                    && category.is_none_or(|c| e.category == c)
            })
            .take(limit)
            .cloned()
            .collect()
    }

    /// Count entries whose severity is at or above `min`.
    pub fn count_at_or_above(&self, min: Severity) -> usize {
        self.entries.iter().filter(|e| e.severity >= min).count()
    }
}

impl Default for LogStore {
    fn default() -> Self { Self::new() }
}

// ── Tauri-managed state ───────────────────────────────────────────────────

/// Tauri-managed wrapper around the `LogStore`.
///
/// The inner `Arc<Mutex<_>>` can be cloned cheaply across command handlers.
pub struct LogState(pub Arc<Mutex<LogStore>>);

impl LogState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(LogStore::new())))
    }

    /// Read the session ID without holding the lock longer than necessary.
    pub fn session_id(&self) -> String {
        self.0
            .lock()
            .map(|s| s.session_id.clone())
            .unwrap_or_else(|_| "unknown".to_owned())
    }

    /// Record a breadcrumb to the rolling trail.
    pub fn breadcrumb(&self, label: impl Into<String>, data: Option<String>) {
        if let Ok(mut store) = self.0.lock() {
            store.add_breadcrumb(label, data);
        }
    }
}

impl Default for LogState {
    fn default() -> Self { Self::new() }
}

// ── Core push helpers ─────────────────────────────────────────────────────

/// **Hot-path entry point.**  Push one entry into all three sinks:
///
/// 1. SQLite `error_log` table (if `conn` is supplied) — best-effort.
/// 2. Tauri `"error:log"` event to all windows — best-effort.
/// 3. In-memory ring-buffer — always succeeds.
///
/// Neither the DB write nor the event emission will ever propagate an error
/// to the caller — the logging layer must be infallible.
pub fn push(
    entry: LogEntry,
    log: &LogState,
    conn: Option<&Connection>,
    app: &tauri::AppHandle,
) {
    // 1. SQLite persistence (best-effort)
    if let Some(c) = conn {
        persist(c, &entry);
    }

    // 2. Real-time IPC event (best-effort)
    let _ = app.emit("error:log", &entry);

    // 3. Ring-buffer
    if let Ok(mut store) = log.0.lock() {
        store.push(entry);
    }
}

/// Push a plain-`String` error produced at a command boundary.
///
/// Logs the error and returns the original `String` so callers can still use
/// `?` to propagate it to Tauri after logging:
///
/// ```rust,ignore
/// editor::open_document(&conn, &path)
///     .map_err(|e| push_str(e, "editor::open_document", Category::Io, &log, Some(&conn), &app))?
/// ```
pub fn push_str(
    msg: String,
    source: &str,
    category: Category,
    log: &LogState,
    conn: Option<&Connection>,
    app: &tauri::AppHandle,
) -> String {
    let entry = LogEntry::from_string_error(
        msg.clone(),
        log.session_id(),
        source,
        category,
        HashMap::new(),
    );
    push(entry, log, conn, app);
    msg
}

/// Push an `AppError` (carries its own severity and category).
pub fn push_err(
    err: &AppError,
    source: &str,
    context: HashMap<String, String>,
    log: &LogState,
    conn: Option<&Connection>,
    app: &tauri::AppHandle,
) {
    let entry = LogEntry::from_app_error(err, log.session_id(), source, context);
    push(entry, log, conn, app);
}

/// Push a non-error event (info, warn, debug).
///
/// Useful for recording successful milestones (e.g. "document opened") so the
/// UI log provides a complete execution timeline, not just failures.
#[allow(clippy::too_many_arguments)]
pub fn push_event(
    severity: Severity,
    category: Category,
    source: &str,
    message: impl Into<String>,
    detail: Option<String>,
    context: HashMap<String, String>,
    log: &LogState,
    conn: Option<&Connection>,
    app: &tauri::AppHandle,
) {
    let entry = LogEntry::new(
        log.session_id(),
        severity,
        category,
        source,
        message,
        detail,
        context,
    );
    push(entry, log, conn, app);
}

// ── SQLite persistence ────────────────────────────────────────────────────

/// Insert one `LogEntry` into `error_log`.  Any DB error is swallowed.
pub fn persist(conn: &Connection, entry: &LogEntry) {
    let ctx = serde_json::to_string(&entry.context).unwrap_or_else(|_| "{}".to_owned());
    let tags_json = serde_json::to_string(&entry.tags).unwrap_or_else(|_| "[]".to_owned());
    let crumbs_json = serde_json::to_string(&entry.breadcrumbs).unwrap_or_else(|_| "[]".to_owned());
    let _ = conn.execute(
        "INSERT OR IGNORE INTO error_log
         (id, session_id, timestamp, severity, category, source, message, detail, context,
          trace_id, span_id, duration_ms, fingerprint, tags, breadcrumbs, seq)
         VALUES (:id, :sid, :ts, :sev, :cat, :src, :msg, :det, :ctx,
                 :tid, :spid, :dur, :fp, :tags, :crumbs, :seq)",
        named_params! {
            ":id":     &entry.id,
            ":sid":    &entry.session_id,
            ":ts":     &entry.timestamp,
            ":sev":    entry.severity.to_string(),
            ":cat":    entry.category.to_string(),
            ":src":    &entry.source,
            ":msg":    &entry.message,
            ":det":    &entry.detail,
            ":ctx":    &ctx,
            ":tid":    &entry.trace_id,
            ":spid":   &entry.span_id,
            ":dur":    &entry.duration_ms,
            ":fp":     &entry.fingerprint,
            ":tags":   &tags_json,
            ":crumbs": &crumbs_json,
            ":seq":    &entry.seq,
        },
    );
}

/// Query the DB for log entries (newest first) with optional filters.
///
/// Uses a single parameterised statement with `IS NULL` guards so all filters
/// are optional without building dynamic SQL.
pub fn query_db(
    conn: &Connection,
    severity: Option<Severity>,
    category: Option<Category>,
    limit: usize,
) -> Vec<LogEntry> {
    let sev_str = severity.map(|s| s.to_string());
    let cat_str = category.map(|c| c.to_string());
    let lim     = limit as i64;

    let Ok(mut stmt) = conn.prepare(
        "SELECT id, session_id, timestamp, severity, category, source, message, detail, context,
                trace_id, span_id, duration_ms, fingerprint, tags, breadcrumbs, seq
         FROM error_log
         WHERE (:sev IS NULL OR severity  = :sev)
           AND (:cat IS NULL OR category  = :cat)
         ORDER BY timestamp DESC
         LIMIT :lim",
    ) else {
        return vec![];
    };

    let rows = stmt.query_map(
        named_params! { ":sev": &sev_str, ":cat": &cat_str, ":lim": &lim },
        |row| {
            let ctx_raw: String = row.get::<_, Option<String>>(8)?.unwrap_or_default();
            let context: HashMap<String, String> =
                serde_json::from_str(&ctx_raw).unwrap_or_default();
            let sev_s: String = row.get(3)?;
            let cat_s: String = row.get(4)?;
            let tags_raw: String = row.get::<_, Option<String>>(13)?.unwrap_or_else(|| "[]".to_owned());
            let tags: Vec<String> = serde_json::from_str(&tags_raw).unwrap_or_default();
            let crumbs_raw: String = row.get::<_, Option<String>>(14)?.unwrap_or_else(|| "[]".to_owned());
            let breadcrumbs: Vec<Breadcrumb> = serde_json::from_str(&crumbs_raw).unwrap_or_default();
            Ok(LogEntry {
                id:         row.get(0)?,
                session_id: row.get(1)?,
                timestamp:  row.get(2)?,
                severity:   str_to_severity(&sev_s),
                category:   str_to_category(&cat_s),
                source:     row.get(5)?,
                message:    row.get(6)?,
                detail:     row.get(7)?,
                context,
                trace_id:    row.get(9)?,
                span_id:     row.get(10)?,
                duration_ms: row.get(11)?,
                fingerprint: row.get(12)?,
                tags,
                breadcrumbs,
                seq:         row.get::<_, Option<u64>>(15)?.unwrap_or(0),
            })
        },
    );

    match rows {
        Ok(iter) => iter.flatten().collect(),
        Err(_)   => vec![],
    }
}

/// Delete all rows from `error_log`.
pub fn clear_db(conn: &Connection) {
    let _ = conn.execute("DELETE FROM error_log", []);
}

// ── Private: string → enum helpers ───────────────────────────────────────

fn str_to_severity(s: &str) -> Severity {
    match s {
        "debug" => Severity::Debug,
        "info"  => Severity::Info,
        "warn"  => Severity::Warn,
        "fatal" => Severity::Fatal,
        _       => Severity::Error,
    }
}

fn str_to_category(s: &str) -> Category {
    match s {
        "parse"         => Category::Parse,
        "db"            => Category::Db,
        "io"            => Category::Io,
        "validation"    => Category::Validation,
        "rule"          => Category::Rule,
        "snapshot"      => Category::Snapshot,
        "serialization" => Category::Serialization,
        "command"       => Category::Command,
        "ui"            => Category::Ui,
        _               => Category::Unknown,
    }
}
