# `docs/` — Project Documentation & Planning

> Development roadmap, engineering task breakdowns, and project planning artifacts.

## Purpose

This directory contains all planning documents that guide AstraXML's development. These files were originally in a `plan/` directory and were consolidated here during the project restructure. They define the phased development approach, sprint breakdowns, and timeline for building the game-modding editor.

---

## Files

### `plan.txt` — Development Plan

The master 6-phase development plan for AstraXML:

| Phase | Name | Focus |
|-------|------|-------|
| **Phase 1** | Foundation | Tauri setup, XML parser, SQLite schema, basic UI shell |
| **Phase 2** | Core Editor | Table/Tree/Raw views, inline editing, search, filter |
| **Phase 3** | Advanced Editing | Schema validation (XSD/DTD), bulk edit rules, import/export |
| **Phase 4** | Schema Intelligence | Auto-complete, context-aware suggestions, validation hints |
| **Phase 5** | Futuristic UX | Macro recording, plugin system, advanced visualization |
| **Phase 6** | Automation | Scripting runtime, batch processing, CI/CD integration |

Each phase builds on the previous one. The editor is currently in **Phase 2** with some Phase 3 groundwork (rules engine, snapshot system) already implemented.

### `Roadmap.txt` — Timeline & Wireframes

A Gantt-style timeline spanning April–October 2026 with:
- Sprint-level scheduling for each phase
- ASCII wireframe mockups of the main editor layout
- Milestone markers for key deliverables
- Dependencies between features

### `Engineering Task Breakdown.txt` — Sprint Details

A detailed 14-sprint breakdown (each sprint = 2 weeks) starting from 2026-04-12:

| Sprint | Dates | Focus |
|--------|-------|-------|
| Sprint 1 | Apr 12–25 | Repo setup, Tauri scaffold, CI/CD |
| Sprint 2 | Apr 26–May 9 | XML parser, SQLite schema, models |
| Sprint 3 | May 10–23 | Basic UI shell, TreeView, node display |
| Sprint 4 | May 24–Jun 6 | TableView, inline editing, search |
| Sprint 5 | Jun 7–20 | FilterBar, DetailPanel, attribute editing |
| Sprint 6 | Jun 21–Jul 4 | RawView, serializer, export |
| Sprint 7 | Jul 5–18 | Error log system, structured logging |
| Sprint 8 | Jul 19–Aug 1 | Diff/snapshot, undo groundwork |
| Sprint 9 | Aug 2–15 | Schema validation (basic), well-formedness |
| Sprint 10 | Aug 16–29 | Rules engine, bulk editing |
| Sprint 11 | Aug 30–Sep 12 | Presets, macros (stub) |
| Sprint 12 | Sep 13–26 | Plugin architecture |
| Sprint 13 | Sep 27–Oct 10 | Advanced UX, polish |
| Sprint 14 | Oct 11–24 | Scripting runtime, batch operations |

---

## Game Modding Context

The phased approach ensures AstraXML delivers value to game modders at each stage:

- **Phase 1–2** (current): Modders can open, view, edit, and save game XML files
- **Phase 3**: Modders can validate configs against schemas before deploying to servers
- **Phase 4**: Auto-complete helps modders discover valid element names and attribute values
- **Phase 5**: Macros let modders record complex editing sequences and replay them
- **Phase 6**: Batch processing enables editing multiple game files at once

---

## Contributing

When adding new documentation:
- Planning documents go in this `docs/` directory
- API documentation should be inline (Rust doc comments, JSDoc)
- Architecture decisions should reference the phase/sprint they belong to
