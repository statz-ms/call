#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_audio;

#[tauri::command]
fn desktop_info() -> String {
    format!("Statz Desktop 1.3.5 capture={}", cfg!(windows))
}

fn main() {
    tauri::Builder::default()
        .manage(app_audio::AudioState::default())
        .invoke_handler(tauri::generate_handler![desktop_info, app_audio::list_audio_apps, app_audio::start_app_audio, app_audio::stop_app_audio])
        .run(tauri::generate_context!())
        .expect("Não foi possível iniciar o Statz");
}
