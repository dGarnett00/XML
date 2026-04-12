/// AstraXML — Centralised application error type.
///
/// Every subsystem converts its errors into `AppError` before bubbling up to
/// the command layer.  `AppError` carries `Severity` and `Category` metadata
/// so the log system can store, stream, and surface events without any extra
/// bookkeeping at the call site.
///
/// Layout
/// ──────
/// • [`Severity`] — how bad is this? (debug → info → warn → error → fatal)
/// • [`Category`] — which subsystem produced it? (parse, db, io, …)
/// • [`AppError`] — the actual error enum (thiserror-derived)
/// • `From` impls — one-shot conversion from every third-party error type
///
/// The sibling `log` module consumes these types.

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub mod log;

// ── Severity ──────────────────────────────────────────────────────────────

/// Log severity.  Ordered from least (Debug) to most (Fatal) severe so that
/// `>=` comparisons give intuitive results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Debug,
    Info,
    Warn,
    Error,
    Fatal,
}

impl std::fmt::Display for Severity {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Severity::Debug => "debug",
            Severity::Info  => "info",
            Severity::Warn  => "warn",
            Severity::Error => "error",
            Severity::Fatal => "fatal",
        })
    }
}

// ── Category ──────────────────────────────────────────────────────────────

/// Top-level error category — the subsystem that produced the event.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Category {
    Parse,
    Db,
    Io,
    Validation,
    Rule,
    Snapshot,
    Serialization,
    Command,
    Ui,
    Unknown,
}

impl std::fmt::Display for Category {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            Category::Parse         => "parse",
            Category::Db            => "db",
            Category::Io            => "io",
            Category::Validation    => "validation",
            Category::Rule          => "rule",
            Category::Snapshot      => "snapshot",
            Category::Serialization => "serialization",
            Category::Command       => "command",
            Category::Ui            => "ui",
            Category::Unknown       => "unknown",
        })
    }
}

// ── AppError ──────────────────────────────────────────────────────────────

/// The single application-level error type.
///
/// All modules map their local errors into this before returning to commands.
/// Each variant knows its own `Severity` and `Category` — the log system reads
/// those at recording time without needing any caller-side annotations.
#[derive(Debug, Error)]
pub enum AppError {
    /// XML parse or encoding failure.
    #[error("XML parse error: {0}")]
    Parse(String),

    /// SQLite database operation failure.
    #[error("Database error: {0}")]
    Db(String),

    /// File-system I/O failure.
    #[error("I/O error: {0}")]
    Io(String),

    /// Well-formedness or schema validation failure.
    #[error("Validation error: {0}")]
    Validation(String),

    /// Bulk-edit rule evaluation or application failure.
    #[error("Rule engine error: {0}")]
    Rule(String),

    /// Snapshot / diff failure.
    #[error("Snapshot error: {0}")]
    Snapshot(String),

    /// Serialization / export failure.
    #[error("Serialization error: {0}")]
    Serialization(String),

    /// Tauri command-layer failure.
    #[error("Command error: {0}")]
    Command(String),

    /// Catch-all for anything not mapped above.
    #[error("{0}")]
    Unknown(String),
}

impl AppError {
    /// Canonical severity for this error variant.
    pub fn severity(&self) -> Severity {
        match self {
            AppError::Db(_) | AppError::Io(_)       => Severity::Fatal,
            AppError::Validation(_)                  => Severity::Warn,
            AppError::Parse(_)
            | AppError::Rule(_)
            | AppError::Snapshot(_)
            | AppError::Serialization(_)
            | AppError::Command(_)
            | AppError::Unknown(_)                   => Severity::Error,
        }
    }

    /// Canonical category for this error variant.
    pub fn category(&self) -> Category {
        match self {
            AppError::Parse(_)         => Category::Parse,
            AppError::Db(_)            => Category::Db,
            AppError::Io(_)            => Category::Io,
            AppError::Validation(_)    => Category::Validation,
            AppError::Rule(_)          => Category::Rule,
            AppError::Snapshot(_)      => Category::Snapshot,
            AppError::Serialization(_) => Category::Serialization,
            AppError::Command(_)       => Category::Command,
            AppError::Unknown(_)       => Category::Unknown,
        }
    }
}

// ── From impls ────────────────────────────────────────────────────────────

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self { AppError::Db(e.to_string()) }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self { AppError::Io(e.to_string()) }
}

impl From<quick_xml::Error> for AppError {
    fn from(e: quick_xml::Error) -> Self { AppError::Parse(e.to_string()) }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self { AppError::Serialization(e.to_string()) }
}

/// Lets callers use `?` on `AppError` inside Tauri command handlers that
/// return `Result<T, String>`.
impl From<AppError> for String {
    fn from(e: AppError) -> Self { e.to_string() }
}
