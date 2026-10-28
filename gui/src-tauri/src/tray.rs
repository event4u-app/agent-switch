// Tray popover window: a borderless, content-sized webview (tray.html) shown
// next to the menu-bar icon on left click and hidden when it loses focus. The
// native menu (Show / Quit) stays on right click as the fallback. Only the
// window shell lives here — the popover's content is the React side.
//
// The main window enables the popover with `set_tray_popover(true)` on mount
// (always — it is the only window tree). Before that call lands, a left click
// shows the main window, so a frontend that failed to load is still reachable.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, Rect, WebviewUrl, WebviewWindowBuilder,
};

pub const TRAY_WINDOW_LABEL: &str = "tray";

const TRAY_W: f64 = 340.0;
const TRAY_H: f64 = 480.0;
const TRAY_MAX_H: f64 = 720.0;
const GAP: f64 = 6.0;
// A click on the tray icon blurs the open popover first (it hides), then the
// click toggles it — which would re-show it at once. A click this soon after a
// blur-hide is the same gesture and only closes.
const REOPEN_GUARD: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct TrayState {
    enabled: AtomicBool,
    // Tray icon rect in physical pixels: x, y, width, height.
    anchor: Mutex<Option<(f64, f64, f64, f64)>>,
    hidden_at: Mutex<Option<Instant>>,
}

pub fn enabled(app: &AppHandle) -> bool {
    app.state::<TrayState>().enabled.load(Ordering::Relaxed)
}

fn rect_physical(rect: &Rect, scale: f64) -> (f64, f64, f64, f64) {
    let pos = rect.position.to_physical::<f64>(scale);
    let size = rect.size.to_physical::<f64>(scale);
    (pos.x, pos.y, size.width, size.height)
}

// Centre under the icon (macOS menu bar, top) or above it (a bottom taskbar),
// clamped to the monitor the icon sits on.
fn place(win: &tauri::WebviewWindow, anchor: (f64, f64, f64, f64)) {
    let (ax, ay, aw, ah) = anchor;
    let Ok(size) = win.outer_size() else { return };
    let (w, h) = (size.width as f64, size.height as f64);
    let monitor = win
        .monitor_from_point(ax + aw / 2.0, ay + ah / 2.0)
        .ok()
        .flatten()
        .or_else(|| win.primary_monitor().ok().flatten());
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    let gap = GAP * scale;
    let (mx, my, mw, mh) = monitor
        .map(|m| {
            (
                m.position().x as f64,
                m.position().y as f64,
                m.size().width as f64,
                m.size().height as f64,
            )
        })
        .unwrap_or((0.0, 0.0, f64::MAX, f64::MAX));
    let below = ay + ah / 2.0 < my + mh / 2.0;
    let mut x = ax + aw / 2.0 - w / 2.0;
    x = x.max(mx + gap).min(mx + mw - w - gap);
    let y = if below { ay + ah + gap } else { ay - h - gap };
    let _ = win.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32));
}

fn ensure_window(app: &AppHandle) -> Result<tauri::WebviewWindow, String> {
    if let Some(win) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        return Ok(win);
    }
    WebviewWindowBuilder::new(app, TRAY_WINDOW_LABEL, WebviewUrl::App("tray.html".into()))
        .title("agent-switch")
        .inner_size(TRAY_W, TRAY_H)
        .transparent(true)
        .decorations(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .focused(true)
        .build()
        .map_err(|e| e.to_string())
}

/// Left click on the tray icon: open the popover at the icon, or close it.
pub fn toggle(app: &AppHandle, rect: &Rect) {
    let state = app.state::<TrayState>();
    if let Some(win) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        if win.is_visible().unwrap_or(false) {
            let _ = win.hide();
            return;
        }
    }
    let recently_hidden = state
        .hidden_at
        .lock()
        .ok()
        .and_then(|t| *t)
        .is_some_and(|t| t.elapsed() < REOPEN_GUARD);
    if recently_hidden {
        return;
    }
    let Ok(win) = ensure_window(app) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let anchor = rect_physical(rect, scale);
    if let Ok(mut a) = state.anchor.lock() {
        *a = Some(anchor);
    }
    place(&win, anchor);
    let _ = win.show();
    let _ = win.set_focus();
}

/// The popover lost focus: hide it and remember when (see REOPEN_GUARD).
pub fn on_blur(window: &tauri::Window) {
    let _ = window.hide();
    if let Ok(mut t) = window.state::<TrayState>().hidden_at.lock() {
        *t = Some(Instant::now());
    }
}

#[tauri::command]
pub fn set_tray_popover(state: tauri::State<TrayState>, enabled: bool) {
    state.enabled.store(enabled, Ordering::Relaxed);
}

#[tauri::command]
pub fn tray_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window(TRAY_WINDOW_LABEL) {
        let _ = win.hide();
    }
}

// The popover follows its card's height (logical px, capped) and stays
// anchored to the icon — above a bottom taskbar it grows upwards.
#[tauri::command]
pub fn tray_resize(app: AppHandle, state: tauri::State<TrayState>, height: f64) {
    let Some(win) = app.get_webview_window(TRAY_WINDOW_LABEL) else {
        return;
    };
    let scale = win.scale_factor().unwrap_or(1.0);
    let h = height.clamp(1.0, TRAY_MAX_H);
    let _ = win.set_size(PhysicalSize::new(
        (TRAY_W * scale).round() as u32,
        (h * scale).round() as u32,
    ));
    if let Some(anchor) = state.anchor.lock().ok().and_then(|a| *a) {
        place(&win, anchor);
    }
}
