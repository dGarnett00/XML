# `schema/` — XML Schema Validation

> Well-formedness checks for game XML configs, with XSD/DTD validation planned for Phase 3.

## Purpose

This module validates XML documents for correctness before modders export them. Currently implements basic well-formedness checks; full schema validation against XSD/DTD definitions is planned for a later development phase.

---

## Files

### `mod.rs` (1 line)

Module declaration:
```rust
pub mod validate;
```

---

### `validate.rs` — Validator (47 lines)

#### `ValidationError`
```rust
pub struct ValidationError {
    pub node_id: i64,
    pub message: String,
    pub severity: String,   // "error" or "warning"
}
```

#### `validate(nodes: &[XmlNode]) → Vec<ValidationError>`

Scans all XML nodes and returns a list of validation errors.

**Current checks:**

| Check | Severity | Description | Game Example |
|-------|----------|-------------|--------------|
| Empty element name | Error | Element has no name | `<>` instead of `<type>` |
| Name starts with digit | Error | XML names can't start with numbers | `<1stItem>` is invalid |

**Implementation:**
```rust
for node in nodes {
    if node.node_type == NodeType::Element {
        if let Some(name) = &node.name {
            if name.is_empty() {
                errors.push(ValidationError { ... "Empty element name" });
            }
            if name.chars().next().map_or(false, |c| c.is_ascii_digit()) {
                errors.push(ValidationError { ... "starts with a digit" });
            }
        }
    }
}
```

---

## Validation Workflow

```
User clicks "Validate" or Exports document
     │
     ▼
commands::validate_document()
     │
     ▼
schema::validate::validate(nodes)
     │
     ▼
Returns Vec<ValidationError>
     │
     ▼
Errors displayed in Error Log Panel
with node_id links for navigation
```

---

## Game Modding Context

Game config files have specific requirements:

- **DayZ types.xml** — Element names must be valid XML identifiers
- **Trader configs** — Values must be within valid ranges
- **Spawn tables** — Required child elements must be present

Currently, only basic XML well-formedness is checked. Future validation will include:

1. **Required children** — `<type>` must have `<nominal>`, `<min>`, etc.
2. **Value ranges** — `nominal` should be ≥ `min`, `lifetime` should be > 0
3. **XSD validation** — Validate against official DayZ XML schemas
4. **DTD support** — Validate against document type definitions
5. **Custom rules** — User-defined validation rules for mod-specific schemas

---

## Planned Enhancements (Phase 3)

| Feature | Status | Description |
|---------|--------|-------------|
| Well-formedness | ✅ Implemented | Basic name validation |
| Value range checks | 🔜 Planned | Numeric range validation |
| Required elements | 🔜 Planned | Missing child element warnings |
| XSD validation | 🔜 Planned | Full XML Schema Definition support |
| DTD validation | 🔜 Planned | Document Type Definition support |
| Custom schemas | 🔜 Planned | User-defined validation rules |
