/// Tauri command handlers — the bridge between the React UI and Rust backend.
use std::collections::HashMap;
use std::sync::Mutex;
use rusqlite::Connection;
use serde::Serialize;
use tauri::State;
use uuid::Uuid;

use crate::app::{editor, search as search_engine, rules};
use crate::core::{diff::snapshot, schema::validate, xml::serializer};
use crate::core::error::{Category, Severity};
use crate::core::error::log::{self, LogEntry, LogState};
use crate::models::{Attribute, Document, NodeType, XmlNode};

/// Global DB connection wrapped in a Mutex for thread-safe access.
pub struct DbState(pub Mutex<Connection>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenDocumentResponse {
    document: Document,
    node_count: usize,
    root_node_id: Option<String>,
    nodes: Vec<XmlNode>,
    attributes: Vec<Attribute>,
}

// ── Document ───────────────────────────────────────────────────────────────

#[tauri::command]
pub fn open_document(
    path: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<OpenDocumentResponse, String> {
    let mut conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::open_document", Category::Db, &log, None, &app))?;
    log.breadcrumb("file.open", Some(path.clone()));
    let result = editor::open_document(&mut conn, &path)
        .map_err(|e| log::push_str(e, "editor::open_document", Category::Io, &log, Some(&conn), &app))?;
    let node_count = result.nodes.len();
    let root_node_id = result.document.root_node_id.clone();
    log::push_event(Severity::Info, Category::Io, "commands::open_document",
        format!("Opened: {path}"), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(OpenDocumentResponse {
        document: result.document,
        node_count,
        root_node_id,
        nodes: result.nodes,
        attributes: result.attributes,
    })
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

// ── Attributes ────────────────────────────────────────────────────────────

/// Return all attributes for every node in a document.
#[tauri::command]
pub fn get_attributes(
    document_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<Attribute>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::get_attributes", Category::Db, &log, None, &app))?;
    let mut stmt = conn
        .prepare(
            "SELECT a.id, a.node_id, a.name, a.value
             FROM attributes a
             JOIN xml_nodes n ON n.id = a.node_id
             WHERE n.document_id = ?1",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::get_attributes", Category::Db, &log, Some(&conn), &app))?;

    let result: Vec<Attribute> = stmt
        .query_map([&document_id], |row| {
            Ok(Attribute {
                id: row.get(0)?,
                node_id: row.get(1)?,
                name: row.get(2)?,
                value: row.get(3)?,
            })
        })
        .map_err(|e| log::push_str(e.to_string(), "commands::get_attributes", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::get_attributes", Category::Db, &log, Some(&conn), &app))?;
    Ok(result)
}

/// Update (or insert) a single attribute value on a node.
#[tauri::command]
pub fn set_attribute(
    node_id: String,
    attr_name: String,
    attr_value: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::set_attribute", Category::Db, &log, None, &app))?;
    conn.execute(
        "UPDATE attributes SET value = ?1 WHERE node_id = ?2 AND name = ?3",
        rusqlite::params![attr_value, node_id, attr_name],
    )
    .map_err(|e| log::push_str(e.to_string(), "commands::set_attribute", Category::Db, &log, Some(&conn), &app))?;
    Ok(())
}

/// Update a child-element's text value for a given type node (e.g. nominal, min).
#[tauri::command]
pub fn set_child_value(
    parent_id: String,
    child_name: String,
    child_value: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::set_child_value", Category::Db, &log, None, &app))?;

    // Find the child node with this parent and name
    let child_id: Option<String> = conn
        .query_row(
            "SELECT id FROM xml_nodes WHERE parent_id = ?1 AND name = ?2 LIMIT 1",
            rusqlite::params![parent_id, child_name],
            |row| row.get(0),
        )
        .ok();

    if let Some(cid) = child_id {
        // Update the text child of that child node
        conn.execute(
            "UPDATE xml_nodes SET value = ?1 WHERE parent_id = ?2 AND node_type = 'text'",
            rusqlite::params![child_value, cid],
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::set_child_value", Category::Db, &log, Some(&conn), &app))?;
    }
    Ok(())
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

// ── Node CRUD ──────────────────────────────────────────────────────────────

/// Add a new node under a given parent. Returns the created node.
#[tauri::command]
pub fn add_node(
    document_id: String,
    parent_id: Option<String>,
    name: String,
    node_type: NodeType,
    value: Option<String>,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<XmlNode, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::add_node", Category::Db, &log, None, &app))?;

    // Determine the next order_index
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(order_index), -1) FROM xml_nodes WHERE document_id = ?1",
            [&document_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    // Determine depth from parent
    let depth: i32 = match &parent_id {
        Some(pid) => {
            conn.query_row(
                "SELECT depth FROM xml_nodes WHERE id = ?1",
                [pid],
                |row| row.get::<_, i32>(0),
            )
            .map(|d| d + 1)
            .unwrap_or(0)
        }
        None => 0,
    };

    let node = XmlNode {
        id: Uuid::new_v4().to_string(),
        document_id: document_id.clone(),
        parent_id: parent_id.clone(),
        node_type,
        name: name.clone(),
        value,
        order_index: max_order + 1,
        depth,
    };

    conn.execute(
        "INSERT INTO xml_nodes (id, document_id, parent_id, node_type, name, value, order_index, depth)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        rusqlite::params![
            &node.id, &node.document_id, &node.parent_id,
            &node.node_type, &node.name, &node.value,
            node.order_index, node.depth
        ],
    )
    .map_err(|e| log::push_str(e.to_string(), "commands::add_node", Category::Db, &log, Some(&conn), &app))?;

    log::push_event(Severity::Info, Category::Command, "commands::add_node",
        format!("Added node: {name}"), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(node)
}

/// Update a node's name and/or value.
#[tauri::command]
pub fn update_node(
    node_id: String,
    name: Option<String>,
    value: Option<String>,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::update_node", Category::Db, &log, None, &app))?;

    if let Some(n) = &name {
        conn.execute(
            "UPDATE xml_nodes SET name = ?1 WHERE id = ?2",
            rusqlite::params![n, &node_id],
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::update_node", Category::Db, &log, Some(&conn), &app))?;
    }
    if let Some(v) = &value {
        conn.execute(
            "UPDATE xml_nodes SET value = ?1 WHERE id = ?2",
            rusqlite::params![v, &node_id],
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::update_node", Category::Db, &log, Some(&conn), &app))?;
    }
    Ok(())
}

/// Deep-clone a node and all its descendants + attributes. Returns the new nodes.
#[tauri::command]
pub fn clone_node(
    node_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<XmlNode>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, None, &app))?;

    // Get the source node
    let src: XmlNode = conn
        .query_row(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE id = ?1",
            [&node_id],
            |row| Ok(XmlNode {
                id: row.get(0)?, document_id: row.get(1)?, parent_id: row.get(2)?,
                node_type: row.get(3)?, name: row.get(4)?, value: row.get(5)?,
                order_index: row.get(6)?, depth: row.get(7)?,
            }),
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    // Max order_index for insertion position
    let max_order: i32 = conn
        .query_row(
            "SELECT COALESCE(MAX(order_index), -1) FROM xml_nodes WHERE document_id = ?1",
            [&src.document_id],
            |row| row.get(0),
        )
        .unwrap_or(-1);

    // Use recursive CTE to collect all descendants in one query
    let mut desc_stmt = conn
        .prepare(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM xml_nodes WHERE id = ?1
                UNION ALL
                SELECT n.id FROM xml_nodes n JOIN descendants d ON n.parent_id = d.id
            )
            SELECT xn.id, xn.document_id, xn.parent_id, xn.node_type, xn.name, xn.value, xn.order_index, xn.depth
            FROM xml_nodes xn JOIN descendants dd ON xn.id = dd.id
            ORDER BY xn.order_index",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    let to_clone: Vec<XmlNode> = desc_stmt
        .query_map([&node_id], |row| Ok(XmlNode {
            id: row.get(0)?, document_id: row.get(1)?, parent_id: row.get(2)?,
            node_type: row.get(3)?, name: row.get(4)?, value: row.get(5)?,
            order_index: row.get(6)?, depth: row.get(7)?,
        }))
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    // Build old_id -> new_id mapping
    let id_map: HashMap<String, String> = to_clone
        .iter()
        .map(|n| (n.id.clone(), Uuid::new_v4().to_string()))
        .collect();

    // Wrap all inserts in a single transaction
    conn.execute("BEGIN", [])
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    // Prepare statements once outside the loop
    let mut insert_node_stmt = conn
        .prepare(
            "INSERT INTO xml_nodes (id, document_id, parent_id, node_type, name, value, order_index, depth)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8)",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    let mut select_attrs_stmt = conn
        .prepare("SELECT id, node_id, name, value FROM attributes WHERE node_id = ?1")
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    let mut insert_attr_stmt = conn
        .prepare("INSERT INTO attributes (id, node_id, name, value) VALUES (?1,?2,?3,?4)")
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    let mut new_nodes: Vec<XmlNode> = Vec::with_capacity(to_clone.len());
    for (i, old_node) in to_clone.iter().enumerate() {
        let new_id = &id_map[&old_node.id];
        let new_parent = if old_node.id == node_id {
            old_node.parent_id.clone()
        } else {
            old_node.parent_id.as_ref().and_then(|pid| id_map.get(pid)).cloned()
        };

        let new_node = XmlNode {
            id: new_id.clone(),
            document_id: old_node.document_id.clone(),
            parent_id: new_parent,
            node_type: old_node.node_type.clone(),
            name: old_node.name.clone(),
            value: old_node.value.clone(),
            order_index: max_order + 1 + i as i32,
            depth: old_node.depth,
        };

        insert_node_stmt.execute(rusqlite::params![
            &new_node.id, &new_node.document_id, &new_node.parent_id,
            &new_node.node_type, &new_node.name, &new_node.value,
            new_node.order_index, new_node.depth
        ])
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

        // Clone attributes
        let attrs: Vec<Attribute> = select_attrs_stmt
            .query_map([&old_node.id], |row| Ok(Attribute {
                id: row.get(0)?, node_id: row.get(1)?, name: row.get(2)?, value: row.get(3)?,
            }))
            .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?
            .collect::<Result<_, _>>()
            .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

        for attr in &attrs {
            insert_attr_stmt.execute(rusqlite::params![
                Uuid::new_v4().to_string(), new_id, &attr.name, &attr.value
            ])
            .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;
        }

        new_nodes.push(new_node);
    }

    // Drop prepared statements before COMMIT (they borrow conn)
    drop(insert_node_stmt);
    drop(select_attrs_stmt);
    drop(insert_attr_stmt);

    conn.execute("COMMIT", [])
        .map_err(|e| log::push_str(e.to_string(), "commands::clone_node", Category::Db, &log, Some(&conn), &app))?;

    log::push_event(Severity::Info, Category::Command, "commands::clone_node",
        format!("Cloned {} nodes", new_nodes.len()), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(new_nodes)
}

/// Delete a node and all its descendants + their attributes.
#[tauri::command]
pub fn delete_node(
    node_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<Vec<String>, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::delete_node", Category::Db, &log, None, &app))?;

    // Use recursive CTE to collect all descendant IDs in one query
    let mut stmt = conn
        .prepare(
            "WITH RECURSIVE descendants(id) AS (
                SELECT id FROM xml_nodes WHERE id = ?1
                UNION ALL
                SELECT n.id FROM xml_nodes n JOIN descendants d ON n.parent_id = d.id
            )
            SELECT id FROM descendants",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::delete_node", Category::Db, &log, Some(&conn), &app))?;

    let to_delete: Vec<String> = stmt
        .query_map([&node_id], |row| row.get(0))
        .map_err(|e| log::push_str(e.to_string(), "commands::delete_node", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::delete_node", Category::Db, &log, Some(&conn), &app))?;

    // Batch delete — ON DELETE CASCADE handles attributes automatically
    conn.execute(
        "WITH RECURSIVE descendants(id) AS (
            SELECT id FROM xml_nodes WHERE id = ?1
            UNION ALL
            SELECT n.id FROM xml_nodes n JOIN descendants d ON n.parent_id = d.id
        )
        DELETE FROM xml_nodes WHERE id IN (SELECT id FROM descendants)",
        [&node_id],
    )
    .map_err(|e| log::push_str(e.to_string(), "commands::delete_node", Category::Db, &log, Some(&conn), &app))?;

    log::push_event(Severity::Info, Category::Command, "commands::delete_node",
        format!("Deleted {} nodes", to_delete.len()), None, HashMap::new(), &log, Some(&conn), &app);
    Ok(to_delete)
}

// ── Serialize ──────────────────────────────────────────────────────────────

/// Return the full XML string for a document (used by RawView).
#[tauri::command]
pub fn serialize_document(
    document_id: String,
    state: State<'_, DbState>,
    log: State<'_, LogState>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let conn = state.0.lock()
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, None, &app))?;

    let mut stmt = conn
        .prepare(
            "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
             FROM xml_nodes WHERE document_id = ?1 ORDER BY order_index",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?;

    let nodes: Vec<XmlNode> = stmt
        .query_map([&document_id], |row| Ok(XmlNode {
            id: row.get(0)?, document_id: row.get(1)?, parent_id: row.get(2)?,
            node_type: row.get(3)?, name: row.get(4)?, value: row.get(5)?,
            order_index: row.get(6)?, depth: row.get(7)?,
        }))
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?;

    let mut stmt2 = conn
        .prepare(
            "SELECT id, node_id, name, value FROM attributes
             WHERE node_id IN (SELECT id FROM xml_nodes WHERE document_id = ?1)",
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?;

    let attributes: Vec<Attribute> = stmt2
        .query_map([&document_id], |row| Ok(Attribute {
            id: row.get(0)?, node_id: row.get(1)?, name: row.get(2)?, value: row.get(3)?,
        }))
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?
        .collect::<Result<_, _>>()
        .map_err(|e: rusqlite::Error| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?;

    let root_id: String = conn
        .query_row(
            "SELECT root_node_id FROM documents WHERE id = ?1",
            [&document_id],
            |row| row.get(0),
        )
        .map_err(|e| log::push_str(e.to_string(), "commands::serialize_document", Category::Db, &log, Some(&conn), &app))?;

    Ok(serializer::serialize(&nodes, &attributes, &root_id))
}
