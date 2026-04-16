# `hooks/` — Custom React Hooks

> Mount-once hooks that wire the frontend into Tauri's event system and browser error APIs.

## Purpose

This directory contains custom React hooks that bridge the gap between the Rust backend, browser runtime errors, and the frontend's structured error log. These hooks ensure that **every error encountered while editing game XML files** — whether from the Rust parser, a JavaScript exception, or an unhandled Promise rejection — is captured, fingerprinted, and displayed in the Error Log Panel.

---

## Files

### `useErrorLog.ts`

A mount-once hook called in `App.tsx` that wires up **three error-capture channels**:

#### 1. Tauri Backend Events (`error:log`)

```
Rust backend → Tauri IPC event → useErrorLog listener → ErrorLog store
```

When the Rust backend encounters an error (XML parse failure, database error, validation issue), it emits a structured `error:log` event via Tauri's event system. This hook listens for those events and pushes them into the Zustand error log store with full metadata:

- `severity` — fatal / error / warn / info / debug
- `category` — parse / db / io / validation / rule / snapshot / serialization / command
- `source`, `message`, `detail` (stack trace)
- `traceId`, `spanId` — for correlating related operations
- `durationMs` — performance timing for timed operations
- `fingerprint` — FNV hash for deduplication in grouped view
- `tags`, `breadcrumbs` — additional context

#### 2. Window Error Handler (`window.onerror`)

Captures synchronous JavaScript errors thrown during rendering, event handlers, or any other synchronous code path. Each error is converted into a `LogEntry` with:

- `severity: 'error'`
- `category: 'ui'`
- `source`: formatted as `filename:lineno:colno`
- `message`: the error message
- `detail`: stack trace from the Error object
- `fingerprint`: generated from `"onerror|" + message`

#### 3. Unhandled Promise Rejections (`unhandledrejection`)

Catches any Promise that rejects without a `.catch()` handler. These are common when Tauri IPC calls fail (e.g., file not found, permission denied). Converted into a `LogEntry` with:

- `severity: 'error'`
- `category: 'ui'`
- `source: 'unhandledrejection'`
- `detail`: extracted stack trace or stringified reason

---

## Helper Functions

### `uiEntry(overrides)`

Factory function that creates a complete `LogEntry` with sensible defaults for UI-originated errors:

- Auto-generates `id` via `crypto.randomUUID()`
- Sets `timestamp` to current ISO string
- Sets `category: 'ui'`, `severity: 'error'`
- Generates monotonically increasing `seq` number
- Initializes empty `tags`, `breadcrumbs`, `context`

### `withDefaults(entry)`

Backfills any missing v2 fields on entries received from Tauri events (which may be from older backend versions):

- Ensures `tags`, `breadcrumbs`, `context` arrays/objects exist
- Sets default `fingerprint` if missing (derived from `source|message`)
- Sets default `seq` if missing

---

## Game Modding Context

When a game modder opens a malformed `types.xml` file (missing closing tags, invalid attribute values), the Rust parser will emit structured errors through the `error:log` channel. This hook ensures those errors are:

1. **Immediately visible** in the Error Log Panel with severity-colored badges
2. **Grouped by fingerprint** — repeated parse errors for the same pattern collapse into a single group
3. **Correlated by trace** — all errors from a single file-open operation share the same `traceId`
4. **Timed** — `durationMs` shows how long the parse attempt took before failing

This gives modders instant feedback about what's wrong with their game config files and exactly where the problem is.
