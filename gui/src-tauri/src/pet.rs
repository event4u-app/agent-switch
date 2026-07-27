// SPIKE (road-to-desktop-pet Phase 0): transparent, frameless, always-on-top
// pet window. Validates transparency + always-on-top + sprite rendering before
// Phase 1 builds the real thing. Throwaway quality by design.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const PET_WINDOW_LABEL: &str = "pet";

const PET_W: f64 = 220.0;
const PET_H: f64 = 280.0;

pub fn show(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        return Ok(());
    }
    let win = WebviewWindowBuilder::new(app, PET_WINDOW_LABEL, WebviewUrl::App("pet.html".into()))
        .title("pet")
        .inner_size(PET_W, PET_H)
        .transparent(true)
        .decorations(false)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .accept_first_mouse(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Bottom-right of the primary work area, offset above the app's own toast
    // corner. Positioning relative to a monitor origin, not center() — the
    // multi-monitor lesson from the AC settings window applies here too.
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let x = pos.x + size.width as i32 - ((PET_W + 24.0) * scale) as i32;
        let y = pos.y + size.height as i32 - ((PET_H + 60.0) * scale) as i32;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
    Ok(())
}

#[tauri::command]
pub fn pet_show(app: AppHandle) -> Result<(), String> {
    show(&app)
}

#[tauri::command]
pub fn pet_hide(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
