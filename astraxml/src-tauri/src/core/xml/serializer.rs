/// Serializes a node tree back to XML text.
use crate::models::{Attribute, NodeType, XmlNode};
use std::collections::HashMap;

pub fn serialize(
    nodes: &[XmlNode],
    attributes: &[Attribute],
    root_id: &str,
) -> String {
    let mut out = String::with_capacity((nodes.len() * 32) + (attributes.len() * 24) + 64);
    out.push_str(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>"#);
    out.push('\n');

    // Build lookup maps
    let node_map: HashMap<&str, &XmlNode> =
        nodes.iter().map(|n| (n.id.as_str(), n)).collect();
    let mut children: HashMap<Option<&str>, Vec<&XmlNode>> = HashMap::new();
    for node in nodes {
        children
            .entry(node.parent_id.as_deref())
            .or_default()
            .push(node);
    }
    // sort by order_index
    for list in children.values_mut() {
        list.sort_by_key(|n| n.order_index);
    }

    let attrs_by_node: HashMap<&str, Vec<&Attribute>> = {
        let mut map: HashMap<&str, Vec<&Attribute>> = HashMap::new();
        for attr in attributes {
            map.entry(attr.node_id.as_str()).or_default().push(attr);
        }
        map
    };

    write_node(
        root_id,
        0,
        &node_map,
        &children,
        &attrs_by_node,
        &mut out,
    );
    out
}

fn write_node(
    node_id: &str,
    indent: usize,
    node_map: &HashMap<&str, &XmlNode>,
    children: &HashMap<Option<&str>, Vec<&XmlNode>>,
    attrs_by_node: &HashMap<&str, Vec<&Attribute>>,
    out: &mut String,
) {
    let node = match node_map.get(node_id) {
        Some(n) => n,
        None => return,
    };

    match node.node_type {
        NodeType::Text => {
            if let Some(v) = &node.value {
                push_indent(out, indent);
                push_escaped_xml(out, v);
                out.push('\n');
            }
        }
        NodeType::Comment => {
            if let Some(v) = &node.value {
                push_indent(out, indent);
                out.push_str("<!--");
                out.push_str(v);
                out.push_str("-->\n");
            }
        }
        NodeType::Element | NodeType::Attribute => {
            let child_nodes = children.get(&Some(node_id));
            let attrs = attrs_by_node.get(node_id);

            if child_nodes.is_none_or(|c| c.is_empty()) {
                push_indent(out, indent);
                out.push('<');
                out.push_str(&node.name);
                write_attrs(out, attrs);
                out.push_str("/>\n");
            } else {
                let kids = child_nodes.unwrap();

                if kids.len() == 1 && kids[0].node_type == NodeType::Text {
                    let text_value = kids[0].value.as_deref().unwrap_or("");
                    push_indent(out, indent);
                    out.push('<');
                    out.push_str(&node.name);
                    write_attrs(out, attrs);
                    out.push('>');
                    push_escaped_xml(out, text_value);
                    out.push_str("</");
                    out.push_str(&node.name);
                    out.push_str(">\n");
                } else {
                    push_indent(out, indent);
                    out.push('<');
                    out.push_str(&node.name);
                    write_attrs(out, attrs);
                    out.push_str(">\n");
                    for kid in kids {
                        write_node(
                            &kid.id,
                            indent + 1,
                            node_map,
                            children,
                            attrs_by_node,
                            out,
                        );
                    }
                    push_indent(out, indent);
                    out.push_str("</");
                    out.push_str(&node.name);
                    out.push_str(">\n");
                }
            }
        }
    }
}

fn write_attrs(out: &mut String, attrs: Option<&Vec<&Attribute>>) {
    if let Some(list) = attrs {
        for attr in list {
            out.push(' ');
            out.push_str(&attr.name);
            out.push_str("=\"");
            push_escaped_xml(out, &attr.value);
            out.push('"');
        }
    }
}

fn push_indent(out: &mut String, indent: usize) {
    for _ in 0..indent {
        out.push_str("    ");
    }
}

fn push_escaped_xml(out: &mut String, s: &str) {
    for c in s.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(c),
        }
    }
}
