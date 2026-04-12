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

// ── Export ─────────────────────────────────────────────────────────────────

/// Serialize all nodes for a document back to XML and write to `dest_path`.
#[tauri::command]
pub fn export_document(
    document_id: String,
    dest_path: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    use crate::core::xml::serializer;

    let conn = state.0.lock().map_err(|e| e.to_string())?;

    // Load nodes
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE document_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| e.to_string())?;

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
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    // Load attributes
    let mut stmt2 = conn
        .prepare(
            "SELECT id, node_id, name, value FROM attributes
             WHERE node_id IN (SELECT id FROM xml_nodes WHERE document_id = ?1)",
        )
        .map_err(|e| e.to_string())?;

    let attributes: Vec<Attribute> = stmt2
        .query_map([&document_id], |row| {
            Ok(Attribute {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                value: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| e.to_string())?;

    // Find root node id
    let root_id: String = conn
        .query_row(
            "SELECT root_node_id FROM documents WHERE id = ?1",
            [&document_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let xml = serializer::serialize(&nodes, &attributes, &root_id);
    std::fs::write(&dest_path, xml).map_err(|e| e.to_string())?;
    Ok(())
}

/// Return all nodes for a document (used to populate the UI after open).
#[tauri::command]
pub fn get_nodes(
    document_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<XmlNode>, String> {
    let conn = state.0.lock().map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE document_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| e.to_string())?;

    stmt.query_map([&document_id], |row| {
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
    .map_err(|e| e.to_string())?
    .collect::<Result<_, _>>()
    .map_err(|e: rusqlite::Error| e.to_string())
}
