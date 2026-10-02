#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[tauri::command]
fn desktop_info() -> String {
    "Statz Desktop 1.3.4 capture=false".to_string()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desktop_info])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Statz");
}
