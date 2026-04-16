# `theme/` — Global CSS Theme

> Neon-dark visual identity for the AstraXML game-modding editor.

## Purpose

This directory contains the global CSS theme that defines the visual identity of AstraXML. The theme uses CSS custom properties (variables) to create a consistent, futuristic neon-dark aesthetic inspired by game editor UIs. Every component in the application inherits its colors, fonts, spacing, and styling from these variables.

---

## Files

### `index.css` (58 lines)

The single theme file, imported at the application entry point (`main.tsx`). It defines:

#### CSS Custom Properties (`:root`)

**Colors:**
| Variable | Value | Usage |
|----------|-------|-------|
| `--bg-deep` | `#0a0e17` | Deepest background (app shell) |
| `--bg-panel` | `#101724` | Panel backgrounds (toolbar, sidebar, status bar) |
| `--bg-surface` | `#162033` | Elevated surfaces (cards, dropdowns) |
| `--bg-hover` | `#1c2a42` | Hover states on interactive elements |
| `--border` | `#1e2d45` | Default border color |
| `--text-primary` | `#e0e6f0` | Primary text color |
| `--text-secondary` | `#7a8ba8` | Secondary/muted text |
| `--text-muted` | `#4a5a75` | Disabled/placeholder text |
| `--accent-blue` | `#3ea8ff` | Primary accent (links, selections, active states) |
| `--accent-green` | `#42d392` | Success states, info indicators |
| `--accent-yellow` | `#ffd866` | Warning indicators |
| `--accent-red` | `#ff4d6a` | Error indicators, danger actions |
| `--accent-purple` | `#b18cff` | Secondary accent (badges, tags) |

**Typography:**
| Variable | Value | Usage |
|----------|-------|-------|
| `--font-ui` | `'Inter', sans-serif` | All UI text (buttons, labels, headers) |
| `--font-mono` | `'JetBrains Mono', monospace` | Code, XML content, attribute values |

**Geometry:**
| Variable | Value | Usage |
|----------|-------|-------|
| `--radius` | `6px` | Default border-radius |
| `--radius-sm` | `4px` | Small elements (pills, badges) |
| `--shadow` | Box shadow definition | Elevated surface shadows |

#### Global Reset

- `*` box-sizing reset (`border-box`)
- `body` — zero margin, `var(--bg-deep)` background, `var(--text-primary)` color, `var(--font-ui)` font

#### Scrollbar Styling

Custom scrollbar for Webkit browsers:
- 8px width
- `var(--bg-surface)` track
- `var(--border)` thumb with hover accent

#### Utility Class

- `.mono` — Applies `var(--font-mono)` for inline code/value display

---

## How the Theme Integrates

Every CSS file in the application references these custom properties:

```css
/* Example from Toolbar.css */
.toolbar {
  background: var(--bg-panel);
  border-bottom: 1px solid var(--border);
}

/* Example from ErrorLogPanel.css */
.errlog__sev--error {
  background: var(--accent-red);
}

/* Example from TreeView.css */
.tree-node__name {
  color: var(--accent-blue);
  font-family: var(--font-mono);
}
```

This means changing a single variable in `index.css` updates the entire application's appearance. For example, changing `--accent-blue` from `#3ea8ff` to `#00ff88` would turn all active states, links, and selections green across every panel, view, and component.

---

## Design Philosophy

The neon-dark theme was chosen for several reasons related to game modding:

1. **Reduced eye strain** — Game modders often work for extended sessions editing hundreds of items. Dark backgrounds with carefully chosen contrast ratios reduce fatigue.

2. **Game editor familiarity** — The aesthetic matches tools that game modders already use (DayZ Server Manager, UnrealEd, Unity dark mode), reducing cognitive friction.

3. **Semantic color coding** — Each accent color has a specific meaning:
   - 🔵 Blue = active/selected (the node you're editing)
   - 🟢 Green = success/info (operation completed)
   - 🟡 Yellow = warning (deprecated attribute, high value)
   - 🔴 Red = error/danger (parse failures, delete actions)
   - 🟣 Purple = metadata (tags, badges, secondary info)

4. **Monospace for data** — Game XML values (item names, numbers) use `JetBrains Mono` for aligned, readable data columns in TableView.
