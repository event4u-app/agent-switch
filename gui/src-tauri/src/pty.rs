//! Embedded PTY terminal — runs `agent-switch <args>` inside the app so
//! interactive flows (login, `run`) never open an external Terminal window.
//!
//! A real pty is required because `claude` is a TTY TUI (piped stdio would
//! break its raw-mode UI). Output streams to the frontend over a Tauri channel;
//! keystrokes and resizes come back via commands. Only the `agent-switch`
//! binary can be launched here — never an arbitrary command.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::ipc::Channel;
use tauri::State;

/// The only binary the embedded terminal may run.
const BIN: &str = "agent-switch";

#[derive(Clone, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TermEvent {
    Data { data: String },
    Exit { code: Option<i32> },
}

struct Session {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyState(Mutex<HashMap<u64, Session>>);

static NEXT_ID: AtomicU64 = AtomicU64::new(1);

fn size(rows: u16, cols: u16) -> PtySize {
    PtySize { rows, cols, pixel_width: 0, pixel_height: 0 }
}

/// Open a pty running `agent-switch <args>`, streaming output to `on_event`.
/// Returns a session id for `term_write` / `term_resize` / `term_close`.
#[tauri::command]
pub fn term_open(
    state: State<PtyState>,
    on_event: Channel<TermEvent>,
    args: Vec<String>,
    rows: u16,
    cols: u16,
) -> Result<u64, String> {
    let pair = native_pty_system()
        .openpty(size(rows.max(1), cols.max(1)))
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new(BIN);
    cmd.args(&args);
    // Inherit the recovered PATH (see recover_user_path) + start in $HOME so
    // relative work isn't rooted at the app bundle.
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    if let Ok(home) = std::env::var("HOME") {
        cmd.cwd(home);
    }

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);

    // Stream pty output to the channel until EOF (process closed the pty),
    // then report exit. Lossy UTF-8 is fine for terminal display.
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).into_owned();
                    if on_event.send(TermEvent::Data { data }).is_err() {
                        break;
                    }
                }
            }
        }
        let _ = on_event.send(TermEvent::Exit { code: None });
    });

    state.0.lock().unwrap().insert(id, Session { writer, master: pair.master, child });
    Ok(id)
}

#[tauri::command]
pub fn term_write(state: State<PtyState>, id: u64, data: String) -> Result<(), String> {
    let mut map = state.0.lock().unwrap();
    let s = map.get_mut(&id).ok_or("no such terminal")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn term_resize(state: State<PtyState>, id: u64, rows: u16, cols: u16) -> Result<(), String> {
    if let Some(s) = state.0.lock().unwrap().get(&id) {
        s.master.resize(size(rows.max(1), cols.max(1))).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn term_close(state: State<PtyState>, id: u64) -> Result<(), String> {
    if let Some(mut s) = state.0.lock().unwrap().remove(&id) {
        let _ = s.child.kill();
    }
    Ok(())
}
