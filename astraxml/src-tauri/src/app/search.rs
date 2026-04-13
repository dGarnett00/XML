/// Search and filter engine.
use rusqlite::{params, Connection};
use serde::{Deserialize, Serialize};

use crate::models::XmlNode;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchQuery {
    pub document_id: String,
    pub text: String,
    pub search_names: bool,
    pub search_values: bool,
    pub search_attributes: bool,
    pub limit: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    pub node: XmlNode,
    pub match_field: String,
    pub snippet: String,
}

/// Full-text search across names, values, and attributes.
/// Runs against the SQLite index for speed — target: 100k nodes < 200ms.
pub fn search(conn: &Connection, query: &SearchQuery) -> Result<Vec<SearchResult>, String> {
    let pattern = format!("%{}%", query.text.to_lowercase());
    let limit = query.limit.unwrap_or(500) as i64;
    let mut results: Vec<SearchResult> = Vec::new();

    if query.search_names || query.search_values {
        let mut stmt = conn
            .prepare(
                "SELECT id, document_id, parent_id, node_type, name, value, order_index, depth
                 FROM xml_nodes
                 WHERE document_id = ?1
                   AND ((?2 = 1 AND lower(name) LIKE ?3)
                     OR (?4 = 1 AND lower(value) LIKE ?3))
                 LIMIT ?5",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(
                params![
                    query.document_id,
                    query.search_names as i32,
                    pattern,
                    query.search_values as i32,
                    limit
                ],
                |row| {
                    let node_type_str: String = row.get(3)?;
                    Ok(XmlNode {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        parent_id: row.get(2)?,
                        node_type: parse_node_type(&node_type_str),
                        name: row.get(4)?,
                        value: row.get(5)?,
                        order_index: row.get(6)?,
                        depth: row.get(7)?,
                    })
                },
            )
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let field = if row.name.to_lowercase().contains(&query.text.to_lowercase()) {
                "name"
            } else {
                "value"
            };
            let snippet = row.value.clone().unwrap_or_else(|| row.name.clone());
            results.push(SearchResult {
                node: row,
                match_field: field.to_string(),
                snippet,
            });
        }
    }

    if query.search_attributes {
        let mut stmt = conn
            .prepare(
                "SELECT n.id, n.document_id, n.parent_id, n.node_type, n.name, n.value,
                        n.order_index, n.depth, a.name as attr_name, a.value as attr_val
                 FROM xml_nodes n
                 JOIN attributes a ON a.node_id = n.id
                 WHERE n.document_id = ?1
                   AND (lower(a.name) LIKE ?2 OR lower(a.value) LIKE ?2)
                 LIMIT ?3",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![query.document_id, pattern, limit], |row| {
                let node_type_str: String = row.get(3)?;
                let attr_name: String = row.get(8)?;
                let attr_val: String = row.get(9)?;
                Ok((
                    XmlNode {
                        id: row.get(0)?,
                        document_id: row.get(1)?,
                        parent_id: row.get(2)?,
                        node_type: parse_node_type(&node_type_str),
                        name: row.get(4)?,
                        value: row.get(5)?,
                        order_index: row.get(6)?,
                        depth: row.get(7)?,
                    },
                    attr_name,
                    attr_val,
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let (node, attr_name, attr_val) = row;
            results.push(SearchResult {
                node,
                match_field: format!("attr:{}", attr_name),
                snippet: attr_val,
            });
        }
    }

    Ok(results)
}

fn parse_node_type(s: &str) -> crate::models::NodeType {
    match s {
        "text" => crate::models::NodeType::Text,
        "comment" => crate::models::NodeType::Comment,
        "attribute" => crate::models::NodeType::Attribute,
        _ => crate::models::NodeType::Element,
    }
}
