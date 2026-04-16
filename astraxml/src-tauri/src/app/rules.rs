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
    if filters.is_empty() {
        // No filters — return all element nodes
        let mut stmt = conn
            .prepare("SELECT id FROM xml_nodes WHERE document_id = ?1 AND node_type = 'element'")
            .map_err(|e| e.to_string())?;
        let ids: Vec<String> = stmt
            .query_map(params![document_id], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .flatten()
            .collect();
        return Ok(ids);
    }

    // Build a single query with JOINs for all filters — eliminates N+1 pattern
    let mut sql = String::from(
        "SELECT DISTINCT n.id FROM xml_nodes n"
    );
    let mut conditions = vec!["n.document_id = ?1".to_string(), "n.node_type = 'element'".to_string()];
    let mut bind_values: Vec<String> = vec![document_id.to_string()];
    let mut param_idx = 2;

    for (i, filter) in filters.iter().enumerate() {
        let alias = format!("a{}", i);
        sql.push_str(&format!(
            " LEFT JOIN attributes {} ON {}.node_id = n.id AND {}.name = ?{}",
            alias, alias, alias, param_idx
        ));
        bind_values.push(filter.field.clone());
        param_idx += 1;

        let filter_cond = match filter.op {
            FilterOp::Equals => format!("{}.value = ?{}", alias, param_idx),
            FilterOp::NotEquals => format!("({}.value IS NULL OR {}.value != ?{})", alias, alias, param_idx),
            FilterOp::Contains => format!("{}.value LIKE '%' || ?{} || '%'", alias, param_idx),
            FilterOp::GreaterThan => format!("CAST({}.value AS REAL) > CAST(?{} AS REAL)", alias, param_idx),
            FilterOp::LessThan => format!("CAST({}.value AS REAL) < CAST(?{} AS REAL)", alias, param_idx),
        };
        conditions.push(filter_cond);
        bind_values.push(filter.value.clone());
        param_idx += 1;
    }

    sql.push_str(" WHERE ");
    sql.push_str(&conditions.join(" AND "));

    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;

    // Bind all parameters dynamically
    let params: Vec<&dyn rusqlite::types::ToSql> = bind_values
        .iter()
        .map(|v| v as &dyn rusqlite::types::ToSql)
        .collect();

    let ids: Vec<String> = stmt
        .query_map(params.as_slice(), |row| row.get(0))
        .map_err(|e| e.to_string())?
        .flatten()
        .collect();

    Ok(ids)
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
