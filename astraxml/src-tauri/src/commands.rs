/// Tauri command handlers — the bridge between the React UI and Rust backend.
use std::collections::HashMap;
use std::sync::Mutex;
use rusqlite::Connection;
use tauri::State;

use crate::app::{editor, search as search_engine, rules};
use crate::core::{diff::snapshot, schema::validate};
use crate::core::error::{Category, Severity};
use crate::core::error::log::{self, LogEntry, LogState};
use crate::models::{Attribute, XmlNode};

/// Global DB connection wrapped in a Mutex for thread-safe access.
pub struct DbState(pub Mutex<Connection>);

// ── Document ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_document(
    path: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::open_document", Category::Db, &log, None, &app))?;
    let result = editor::open_document(&conn, &path)
        .map_err(|e| log::push_str(e, "editor::open_document", Category::Io, &log, Some(&conn), &app))?;
    log::push_event(Severity::Info, Category::Io, "commands::open_document",
        format!("Opened: {path}"), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(serde_json::json!({
        "document": result.document,
        "nodeCount": result.nodes.len(),
        "rootNodeId": result.document.root_node_id,
    }))
}

// ── Search ─────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn search_nodes(
    query: search_engine::SearchQuery,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<search_engine::SearchResult>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::search_nodes", Category::Db, &log, None, &app))?;
    search_engine::search(&conn, &query)
        .map_err(|e| log::push_str(e, "search_engine::search", Category::Command, &log, Some(&conn), &app))
}

// ── Rules ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn preview_rule(
    document_id: String,
    rule: rules::Rule,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<rules::RulePreviewResult, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::preview_rule", Category::Db, &log, None, &app))?;
    rules::preview(&conn, &document_id, &rule)
        .map_err(|e| log::push_str(e, "rules::preview", Category::Rule, &log, Some(&conn), &app))
}

#[tauri::command]
pub fn apply_rule(
    document_id: String,
    rule: rules::Rule,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<usize, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::apply_rule", Category::Db, &log, None, &app))?;
    let count = rules::apply(&conn, &document_id, &rule)
        .map_err(|e| log::push_str(e, "rules::apply", Category::Rule, &log, Some(&conn), &app))?;
    log::push_event(Severity::Info, Category::Rule, "commands::apply_rule",
        format!("Applied rule to {count} nodes"), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(count)
}

// ── Snapshots ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_snapshots(
    document_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<crate::models::EditSnapshot>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::list_snapshots", Category::Db, &log, None, &app))?;
    snapshot::list_snapshots(&conn, &document_id)
        .map_err(|e| log::push_str(e, "snapshot::list_snapshots", Category::Snapshot, &log, Some(&conn), &app))
}

// ── Validation ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn validate_document(
    nodes: Vec<XmlNode>,
    attributes: Vec<Attribute>,
) -> Vec<validate::ValidationError> {
    validate::validate(&nodes, &attributes)
}

// ── Export ─────────────────────────────────────────────────────────────────

/// Serialize all nodes for a document back to XML and write to `dest_path`.
#[tauri::command]
pub fn export_document(
    document_id: String,
    dest_path: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    use crate::core::xml::serializer;

    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, None, &app))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE document_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?;

    let nodes: Vec<XmlNode> = stmt
        .query_map([&document_id], |row| {
            Ok(XmlNode {
                id: row.get(0)?,
                document_id: row.get(1)?,
                parent_id: row.get(2)?,
                node_type: row.get(3)?,
                name: row.get(4)?,
                value: row.get(5)?,
                order_index: row.get(6)?,
                depth: row.get(7)?,
            })
        })
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?;

    let mut stmt2 = conn
        .prepare(
            "SELECT id, node_id, name, value FROM attributes
             WHERE node_id IN (SELECT id FROM xml_nodes WHERE document_id = ?1)",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?;

    let attributes: Vec<Attribute> = stmt2
        .query_map([&document_id], |row| {
            Ok(Attribute {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                value: row.get(3)?,
            })
        })
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?;

    let root_id: String = conn
        .query_row(
            "SELECT root_node_id FROM documents WHERE id = ?1",
            [&document_id],
            |row| row.get(0),
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Db, &log, Some(&conn), &app))?;

    let xml = serializer::serialize(&nodes, &attributes, &root_id);
    std::fs::write(&dest_path, &xml)
        .map_err(|e| log::push_str(e.to_string(), "commands::export_document", Category::Io, &log, Some(&conn), &app))?;
    log::push_event(Severity::Info, Category::Io, "commands::export_document",
        format!("Exported to: {dest_path}"), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(())
}

/// Return all nodes for a document (used to populate the UI after open).
#[tauri::command]
pub fn get_nodes(
    document_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<XmlNode>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::get_nodes", Category::Db, &log, None, &app))?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE document_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::get_nodes", Category::Db, &log, Some(&conn), &app))?;

    let result: Vec<XmlNode> = stmt
        .query_map([&document_id], |row| {
            Ok(XmlNode {
                id: row.get(0)?,
                document_id: row.get(1)?,
                parent_id: row.get(2)?,
                node_type: row.get(3)?,
                name: row.get(4)?,
                value: row.get(5)?,
                order_index: row.get(6)?,
                depth: row.get(7)?,
            })
        })
        .map_err(|e| log::push_str(e.to_string(), "commands::get_nodes", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::get_nodes", Category::Db, &log, Some(&conn), &app))?;
    Ok(result)
}

// ── Error Log ─────────────────────────────────────────────────────────────

/// Return up to `limit` log entries from the in-memory ring-buffer (newest first).
/// Omit `limit` (or pass 0) to retrieve all buffered entries.
#[tauri::command]
pub fn get_error_log(
    limit: Option<usize>,
    log: State<'_, LogState>,
) -> Vec<LogEntry> {
    let n = limit.unwrap_or(0);
    if let Ok(store) = log.0.lock() {
        let cap = if n == 0 { store.len() } else { n };
        store.query(None, None, cap)
    } else {
        vec![]
    }
}

/// Clear the in-memory ring-buffer **and** the persisted `error_log` table.
#[tauri::command]
pub fn clear_error_log(
    state: State<'_, DbState>,
    log: State<'_, LogState>,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    log::clear_db(&conn);
    if let Ok(mut store) = log.0.lock() {
        store.clear();
    }
    Ok(())
}

/// Serialise all in-memory log entries to a JSON string for client-side export.
#[tauri::command]
pub fn export_error_log(log: State<'_, LogState>) -> String {
    if let Ok(store) = log.0.lock() {
        let entries: Vec<&LogEntry> = store.entries().collect();
        serde_json::to_string_pretty(&entries).unwrap_or_else(|_| "[]".to_owned())
    } else {
        "[]".to_owned()
    }
}

/// Accept a UI-side error from the React layer and record it in the shared log.
/// Called by `useErrorLog` for errors caught by the JS error boundary or
/// other frontend catch blocks that want backend persistence.
#[tauri::command]
pub fn log_ui_error(
    message: String,
    source: String,
    detail: Option<String>,
    context: HashMap<String, String>,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let entry = LogEntry::new(
        log.session_id(),
        Severity::Error,
        crate::core::error::Category::Ui,
        source,
        message,
        detail,
        context,
    );
    log::push(entry, &log, Some(&conn), &app);
    Ok(())
}

/// Return the current session ID so the frontend can tag its own entries
/// with the same ID as the backend.
#[tauri::command]
pub fn get_session_id(log: State<'_, LogState>) -> String {
    log.session_id()
}
