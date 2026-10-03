use serde::Serialize;
use std::sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex};
use std::{thread, time::{Duration, Instant}};
use tauri::{ipc::{Channel, InvokeResponseBody}, State};

#[derive(Serialize)]
pub struct AudioApp { pid: u32, name: String, state: String }

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioFormat { sample_rate: u32, channels: u16 }

struct Worker { stop: Arc<AtomicBool>, handle: thread::JoinHandle<()> }
impl Drop for Worker {
    fn drop(&mut self) {
        self.stop.store(true, Ordering::Release);
        // Activation is an asynchronous Windows operation. Never freeze the UI
        // indefinitely if a driver does not finish activation.
        let deadline = Instant::now() + Duration::from_millis(500);
        while !self.handle.is_finished() && Instant::now() < deadline {
            thread::sleep(Duration::from_millis(10));
        }
    }
}

#[derive(Default, Clone)]
pub struct AudioState(Arc<Mutex<Option<Worker>>>);

fn error(e: impl std::fmt::Display) -> String { e.to_string() }

#[tauri::command]
pub async fn list_audio_apps() -> Result<Vec<AudioApp>, String> {
    tauri::async_runtime::spawn_blocking(list_apps).await.map_err(error)?
}

#[tauri::command]
pub async fn stop_app_audio(state: State<'_, AudioState>) -> Result<(), String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        state.0.lock().map_err(error)?.take();
        Ok(())
    }).await.map_err(error)?
}

#[tauri::command]
pub async fn start_app_audio(pid: u32, sample_rate: u32,
    on_audio: Channel<InvokeResponseBody>, state: State<'_, AudioState>
) -> Result<AudioFormat, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if pid == 0 || !(8_000..=192_000).contains(&sample_rate) {
            return Err("Aplicativo ou formato de áudio inválido.".into());
        }
        // Only accept a process listed by the audio-session enumerator. This
        // also excludes Statz/WebView and prevents capturing our received call.
        if !list_apps()?.iter().any(|app| app.pid == pid) {
            return Err("O aplicativo não está mais disponível. Atualize a lista.".into());
        }
        let mut current = state.0.lock().map_err(error)?;
        current.take();
        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = stop.clone();
        let (ready_tx, ready_rx) = std::sync::mpsc::sync_channel(1);
        let handle = thread::Builder::new().name("statz-app-audio".into()).spawn(move || {
            let result = capture(pid, sample_rate, on_audio.clone(), &worker_stop, &ready_tx);
            if let Err(message) = result {
                let _ = ready_tx.try_send(Err(message.clone()));
                let _ = on_audio.send(InvokeResponseBody::Json(serde_json::json!({"error": format!("Captura interrompida: {message}")}).to_string()));
                eprintln!("Captura de áudio: {message}");
            }
        }).map_err(error)?;
        let worker = Worker { stop, handle };
        match ready_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(Ok(format)) => { *current = Some(worker); Ok(format) }
            Ok(Err(message)) => Err(message),
            Err(_) => Err("O Windows não iniciou a captura. Esse recurso exige Windows 10 build 20348 ou Windows 11.".into()),
        }
    }).await.map_err(error)?
}

#[cfg(windows)]
struct Com;
#[cfg(windows)]
impl Com {
    fn init() -> Result<Self, String> { wasapi::initialize_mta().ok().map_err(error)?; Ok(Self) }
}
#[cfg(windows)]
impl Drop for Com { fn drop(&mut self) { wasapi::deinitialize(); } }

#[cfg(windows)]
fn app_root(pid: u32, system: &sysinfo::System) -> u32 {
    let mut id = sysinfo::Pid::from_u32(pid);
    // Chromium's audio session belongs to a subprocess. Walk only parents
    // with the same executable, never unrelated launchers or the shell.
    for _ in 0..32 {
        let Some(process) = system.process(id) else { break };
        let Some(parent_id) = process.parent() else { break };
        let Some(parent) = system.process(parent_id) else { break };
        if parent.name() != process.name() { break; }
        id = parent_id;
    }
    id.as_u32()
}

#[cfg(windows)]
fn list_apps() -> Result<Vec<AudioApp>, String> {
    use wasapi::{DeviceEnumerator, Direction, SessionState};
    let _com = Com::init()?;
    let system = sysinfo::System::new_all();
    let enumerator = DeviceEnumerator::new().map_err(error)?;
    let devices = enumerator.get_device_collection(&Direction::Render).map_err(error)?;
    let mut apps = std::collections::BTreeMap::<u32, AudioApp>::new();
    for device in &devices {
        let Ok(device) = device else { continue };
        let Ok(manager) = device.get_iaudiosessionmanager() else { continue };
        let Ok(sessions) = manager.get_audiosessionenumerator() else { continue };
        for i in 0..sessions.get_count().map_err(error)? {
            let Ok(control) = sessions.get_session(i) else { continue };
            let Ok(pid) = control.get_process_id() else { continue };
            if pid == 0 { continue; }
            let pid = app_root(pid, &system);
            let Some(process) = system.process(sysinfo::Pid::from_u32(pid)) else { continue };
            let name = process.name().to_string_lossy().into_owned();
            if pid == std::process::id() || name.eq_ignore_ascii_case("msedgewebview2.exe") {
                continue;
            }
            let Ok(state) = control.get_state() else { continue };
            if state == SessionState::Expired { continue; }
            let active = state == SessionState::Active;
            let entry = apps.entry(pid).or_insert(AudioApp { pid, name, state: "inactive".into() });
            if active { entry.state = "active".into(); }
        }
    }
    let mut apps: Vec<_> = apps.into_values().collect();
    apps.sort_by_key(|app| app.name.to_lowercase());
    Ok(apps)
}

#[cfg(windows)]
fn capture(pid: u32, rate: u32, output: Channel<InvokeResponseBody>, stop: &AtomicBool,
    ready: &std::sync::mpsc::SyncSender<Result<AudioFormat, String>>
) -> Result<(), String> {
    use wasapi::{AudioClient, Direction, SampleType, StreamMode, WaveFormat};
    let _com = Com::init()?;
    // Include ONLY the selected executable's process tree. Never fall back to
    // whole-system loopback, which would transmit Discord and cause echo.
    let mut client = AudioClient::new_application_loopback_client(pid, true).map_err(error)?;
    let format = WaveFormat::new(32, 32, &SampleType::Float, rate as usize, 2, None);
    client.initialize_client(&format, &Direction::Capture,
        &StreamMode::EventsShared { autoconvert: true, buffer_duration_hns: 200_000 }).map_err(error)?;
    let event = client.set_get_eventhandle().map_err(error)?;
    let input = client.get_audiocaptureclient().map_err(error)?;
    if stop.load(Ordering::Acquire) { return Ok(()); }
    client.start_stream().map_err(error)?;
    let result = (|| {
        ready.send(Ok(AudioFormat { sample_rate: rate, channels: 2 })).map_err(error)?;
        while !stop.load(Ordering::Acquire) {
            while let Some(frames) = input.get_next_packet_size().map_err(error)? {
                if frames == 0 || stop.load(Ordering::Acquire) { break; }
                let mut bytes = vec![0; frames as usize * 8];
                let (read, _) = input.read_from_device(&mut bytes).map_err(error)?;
                bytes.truncate(read as usize * 8);
                if !bytes.is_empty() { output.send(InvokeResponseBody::Raw(bytes)).map_err(error)?; }
            }
            // Silence is normal; an event timeout does not end capture.
            let _ = event.wait_for_event(100);
        }
        Ok(())
    })();
    let _ = client.stop_stream();
    result
}

#[cfg(not(windows))]
fn list_apps() -> Result<Vec<AudioApp>, String> { Err("Áudio por aplicativo disponível apenas no Windows.".into()) }
#[cfg(not(windows))]
fn capture(_: u32, _: u32, _: Channel<InvokeResponseBody>, _: &AtomicBool,
    _: &std::sync::mpsc::SyncSender<Result<AudioFormat, String>>
) -> Result<(), String> { Err("Áudio por aplicativo disponível apenas no Windows.".into()) }

