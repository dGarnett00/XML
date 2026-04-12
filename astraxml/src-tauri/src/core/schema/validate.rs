/// Schema validation stub — full XSD/DTD engine arrives in Phase 3 (Sprint 5).
use crate::models::{Attribute, XmlNode};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ValidationError {
    pub node_id: String,
    pub message: String,
    pub severity: Severity,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum Severity {
    Error,
    Warning,
    Info,
}

/// Basic well-formedness checks. Full XSD/DTD validation added in Sprint 5.
pub fn validate(
    nodes: &[XmlNode],
    _attributes: &[Attribute],
) -> Vec<ValidationError> {
    let mut errors = Vec::new();

    for node in nodes {
        if node.name.trim().is_empty() {
            errors.push(ValidationError {
                node_id: node.id.clone(),
                message: "Element name cannot be empty".to_string(),
                severity: Severity::Error,
            });
        }
        if node.name.starts_with(|c: char| c.is_ascii_digit()) {
            errors.push(ValidationError {
                node_id: node.id.clone(),
                message: format!(
                    "Element name '{}' must not start with a digit",
                    node.name
                ),
                severity: Severity::Error,
            });
        }
    }

    errors
}
