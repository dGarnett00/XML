/// Bulk edit rules engine — Phase 2.
/// Evaluates IF/THEN rule chains against filtered nodes transactionally.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum FilterOp {
    Equals,
    NotEquals,
    Contains,
    GreaterThan,
    LessThan,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleFilter {
    pub field: String,
    pub op: FilterOp,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ActionType {
    SetAttribute,
    AddTag,
    RemoveTag,
    SetValue,
    DeleteNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuleAction {
    pub action: ActionType,
    pub field: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub filters: Vec<RuleFilter>,
    pub actions: Vec<RuleAction>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RulePreviewResult {
    pub affected_node_ids: Vec<String>,
    pub count: usize,
}

/// Preview how many nodes a rule would affect without modifying data.
pub fn preview(
    conn: &Connection,
    document_id: &str,
    rule: &Rule,
) -> Result<RulePreviewResult, String> {
    let node_ids = filter_nodes(conn, document_id, &rule.filters)?;
    let count = node_ids.len();
    Ok(RulePreviewResult {
        affected_node_ids: node_ids,
        count,
    })
}

/// Apply a rule transactionally. All actions are atomic.
pub fn apply(
    conn: &Connection,
    document_id: &str,
    rule: &Rule,
) -> Result<usize, String> {
    let node_ids = filter_nodes(conn, document_id, &rule.filters)?;
    let count = node_ids.len();

    conn.execute("BEGIN", []).map_err(|e| e.to_string())?;

    for node_id in &node_ids {
        for action in &rule.actions {
            execute_action(conn, node_id, action)?;
        }
    }

    conn.execute("COMMIT", []).map_err(|e| e.to_string())?;
    Ok(count)
}

fn filter_nodes(
    conn: &Connection,
    document_id: &str,
    filters: &[RuleFilter],
) -> Result<Vec<String>, String> {
    // Start with all element nodes in the document
    let mut stmt = conn
        .prepare("SELECT id FROM xml_nodes WHERE document_id = ?1 AND node_type = 'element'")
        .map_err(|e| e.to_string())?;

    let all_ids: Vec<String> = stmt
        .query_map(params![document_id], |row| row.get(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    // Filter in memory for now — will be SQL-optimized in Sprint 10
    let mut matching = Vec::new();
    for node_id in all_ids {
        if node_matches(conn, &node_id, filters)? {
            matching.push(node_id);
        }
    }

    Ok(matching)
}

fn node_matches(
    conn: &Connection,
    node_id: &str,
    filters: &[RuleFilter],
) -> Result<bool, String> {
    for filter in filters {
        let val: Option<String> = conn
            .query_row(
                "SELECT a.value FROM attributes a WHERE a.node_id = ?1 AND a.name = ?2",
                params![node_id, filter.field],
                |row| row.get(0),
            )
            .ok();

        let val = match val {
            Some(v) => v,
            None => continue,
        };

        let matches = match filter.op {
            FilterOp::Equals => val == filter.value,
            FilterOp::NotEquals => val != filter.value,
            FilterOp::Contains => val.contains(&filter.value),
            FilterOp::GreaterThan => {
                val.parse::<f64>().unwrap_or(f64::NEG_INFINITY)
                    > filter.value.parse::<f64>().unwrap_or(f64::NEG_INFINITY)
            }
            FilterOp::LessThan => {
                val.parse::<f64>().unwrap_or(f64::INFINITY)
                    < filter.value.parse::<f64>().unwrap_or(f64::INFINITY)
            }
        };

        if !matches {
            return Ok(false);
        }
    }
    Ok(true)
}

fn execute_action(
    conn: &Connection,
    node_id: &str,
    action: &RuleAction,
) -> Result<(), String> {
    match action.action {
        ActionType::SetAttribute => {
            // Upsert attribute
            conn.execute(
                "INSERT INTO attributes (id, node_id, name, value)
                 VALUES (lower(hex(randomblob(16))), ?1, ?2, ?3)
                 ON CONFLICT(id) DO UPDATE SET value = ?3",
                params![node_id, action.field, action.value],
            )
            .map_err(|e| e.to_string())?;
        }
        ActionType::SetValue => {
            conn.execute(
                "UPDATE xml_nodes SET value = ?1 WHERE id = ?2",
                params![action.value, node_id],
            )
            .map_err(|e| e.to_string())?;
        }
        ActionType::AddTag => {
            conn.execute(
                "INSERT OR IGNORE INTO tags (id, document_id, node_id, name)
                 SELECT lower(hex(randomblob(16))), document_id, ?1, ?2
                 FROM xml_nodes WHERE id = ?1",
                params![node_id, action.value],
            )
            .map_err(|e| e.to_string())?;
        }
        ActionType::RemoveTag => {
            conn.execute(
                "DELETE FROM tags WHERE node_id = ?1 AND name = ?2",
                params![node_id, action.value],
            )
            .map_err(|e| e.to_string())?;
        }
        ActionType::DeleteNode => {
            conn.execute("DELETE FROM xml_nodes WHERE id = ?1", params![node_id])
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}
