use chrono::{DateTime, Utc};
use rusqlite::types::{FromSql, FromSqlError, FromSqlResult, ToSql, ToSqlOutput, ValueRef};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Document {
    pub id: String,
    pub path: String,
    pub display_name: String,
    pub xml_version: String,
    pub encoding: String,
    pub root_node_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub last_opened_at: DateTime<Utc>,
    pub schema_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum NodeType {
    Element,
    Attribute,
    Text,
    Comment,
}

impl FromSql for NodeType {
    fn column_result(value: ValueRef<'_>) -> FromSqlResult<Self> {
        match value.as_str()? {
            "element" => Ok(NodeType::Element),
            "attribute" => Ok(NodeType::Attribute),
            "text" => Ok(NodeType::Text),
            "comment" => Ok(NodeType::Comment),
            other => Err(FromSqlError::Other(
                format!("unknown NodeType: {other}").into(),
            )),
        }
    }
}

impl ToSql for NodeType {
    fn to_sql(&self) -> rusqlite::Result<ToSqlOutput<'_>> {
        let s = match self {
            NodeType::Element => "element",
            NodeType::Attribute => "attribute",
            NodeType::Text => "text",
            NodeType::Comment => "comment",
        };
        Ok(ToSqlOutput::from(s))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct XmlNode {
    pub id: String,
    pub document_id: String,
    pub parent_id: Option<String>,
    pub node_type: NodeType,
    pub name: String,
    pub value: Option<String>,
    pub order_index: i32,
    pub depth: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Attribute {
    pub id: String,
    pub node_id: String,
    pub name: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Tag {
    pub id: String,
    pub document_id: String,
    pub node_id: String,
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EditSnapshot {
    pub id: String,
    pub document_id: String,
    pub created_at: DateTime<Utc>,
    pub diff_blob: String,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum PresetType {
    Filter,
    BulkEdit,
    Export,
    Validation,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub preset_type: PresetType,
    pub payload: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Macro {
    pub id: String,
    pub name: String,
    pub steps: serde_json::Value,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "UPPERCASE")]
pub enum SchemaType {
    Xsd,
    Dtd,
    Inferred,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Schema {
    pub id: String,
    pub document_id: String,
    pub schema_type: SchemaType,
    pub raw_schema: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IndexEntry {
    pub id: String,
    pub document_id: String,
    pub node_id: String,
    pub name_hash: String,
    pub value_hash: String,
    pub path_string: String,
    pub tags: Vec<String>,
    pub numeric_cache: Option<f64>,
}
