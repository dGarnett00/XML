/// Tauri command handlers — the bridge between the React UI and Rust backend.
use std::sync::Mutex;
use rusqlite::Connection;
use tauri::State;

use crate::app::{editor, search as search_engine, rules};
use crate::core::{diff::snapshot, schema::validate};
use crate::models::{Attribute, XmlNode};

/// Global DB connection wrapped in a Mutex for thread-safe access.
pub struct DbState(pub Mutex<Connection>);

// ── Document ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_document(
    path: String,
    state: State<'_, DbState>,
) -> Result<serde_json::Value, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let result = editor::open_document(&conn, &path)?;
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
) -> Result<Vec<search_engine::SearchResult>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    search_engine::search(&conn, &query)
}

// ── Rules ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn preview_rule(
    document_id: String,
    rule: rules::Rule,
    state: State<'_, DbState>,
) -> Result<rules::RulePreviewResult, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    rules::preview(&conn, &document_id, &rule)
}

#[tauri::command]
pub fn apply_rule(
    document_id: String,
    rule: rules::Rule,
    state: State<'_, DbState>,
) -> Result<usize, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    rules::apply(&conn, &document_id, &rule)
}

// ── Snapshots ──────────────────────────────────────────────────────────────

#[tauri::command]
pub fn list_snapshots(
    document_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<crate::models::EditSnapshot>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    snapshot::list_snapshots(&conn, &document_id)
}

// ── Validation ─────────────────────────────────────────────────────────────

#[tauri::command]
pub fn validate_document(
    nodes: Vec<XmlNode>,
    attributes: Vec<Attribute>,
) -> Vec<validate::ValidationError> {
    validate::validate(&nodes, &attributes)
}
