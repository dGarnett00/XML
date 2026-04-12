pub mod models;
pub mod core;
pub mod app;
pub mod commands;

use std::sync::Mutex;
use commands::DbState;
use core::db::setup;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Open (or create) the local database in the app data directory.
    // Falls back to in-memory for tests/dev if path unavailable.
    let conn = setup::open_in_memory().expect("failed to open local database");

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(DbState(Mutex::new(conn)))
        .invoke_handler(tauri::generate_handler![
            commands::open_document,
            commands::get_nodes,
            commands::search_nodes,
            commands::preview_rule,
            commands::apply_rule,
            commands::list_snapshots,
            commands::validate_document,
            commands::export_document,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
