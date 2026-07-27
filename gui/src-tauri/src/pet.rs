// Desktop-pet overlay window (road-to-desktop-pet Phase 1). A transparent,
// frameless, always-on-top companion the React side shows/hides from the
// settings toggle; the pet webview itself (pet.html / pet-main.ts) owns
// rendering, position persistence, and notification reactions. This module
// only owns the window shell — no profile logic, mirroring main.rs.

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub const PET_WINDOW_LABEL: &str = "pet";

const PET_W: f64 = 240.0;
const PET_H: f64 = 330.0;

// Bottom-right of the primary work area, offset above the app's own toast
// corner. Positioned from the monitor origin, not center() — the multi-monitor
// lesson from the AC settings window applies here too. Uses the ACTUAL window
// size: the pet webview resizes itself to the size setting after creation.
fn position_bottom_right(win: &tauri::WebviewWindow) {
    if let Ok(Some(monitor)) = win.primary_monitor() {
        let size = monitor.size();
        let pos = monitor.position();
        let scale = monitor.scale_factor();
        let win_size = win
            .outer_size()
            .unwrap_or(tauri::PhysicalSize::new((PET_W * scale) as u32, (PET_H * scale) as u32));
        let x = pos.x + size.width as i32 - win_size.width as i32 - (24.0 * scale) as i32;
        let y = pos.y + size.height as i32 - win_size.height as i32 - (60.0 * scale) as i32;
        let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    }
}

// Returns true when the window was freshly CREATED (its webview still has to
// boot and register listeners), false when an existing one was just shown.
pub fn show(app: &AppHandle) -> Result<bool, String> {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        win.show().map_err(|e| e.to_string())?;
        return Ok(false);
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

    // Default corner; the pet webview restores a persisted drag position on
    // startup (validated against the current monitors) and wins over this.
    position_bottom_right(&win);

    // Windows drops always-on-top when other overlays assert theirs; re-assert
    // on a slow interval (openpets uses 1s; 5s is enough for a companion). The
    // loop ends itself once the window is gone.
    #[cfg(target_os = "windows")]
    {
        let w = win.clone();
        std::thread::spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(5));
            if w.set_always_on_top(true).is_err() {
                break;
            }
        });
    }

    Ok(true)
}

#[tauri::command]
pub fn pet_show(app: AppHandle) -> Result<bool, String> {
    show(&app)
}

#[tauri::command]
pub fn pet_hide(app: AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// "Reset pet position" (Settings → Pet): back to the default corner. The
// caller clears the persisted drag position first (shared localStorage).
#[tauri::command]
pub fn pet_reset_position(app: AppHandle) {
    if let Some(win) = app.get_webview_window(PET_WINDOW_LABEL) {
        position_bottom_right(&win);
    }
}
