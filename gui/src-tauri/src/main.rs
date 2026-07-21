// agent-switch tray/menubar shell. The window hosts the React UI, which drives
// the `agent-switch` CLI via the shell plugin; this Rust side only owns the
// tray icon, the window, the Dock presence, and launch-at-login. No profile
// logic lives here.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod pty;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

// Whether the yellow "minimize" button minimizes the window into the Dock
// (macOS standard) or drops the app out of the Dock entirely — same as close.
// Pushed from the UI (Settings → General) via `set_minimize_to_dock`. Default
// off: minimizing behaves like closing (the app leaves the Dock).
#[derive(Default)]
struct DockPrefs {
    minimize_to_dock: AtomicBool,
}

// Show the main window and give the app a Dock presence. On macOS the Regular
// activation policy is what puts the icon in the Dock; the app starts as an
// Accessory (menu-bar only) and becomes Regular the moment its window is shown.
fn show_main(app: &tauri::AppHandle) {
    #[cfg(target_os = "macos")]
    let _ = app.set_activation_policy(tauri::ActivationPolicy::Regular);
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// Hide the window and remove the app from the Dock (macOS Accessory policy).
// The tray icon keeps the app alive, so it is re-shown from there (or, when a
// Dock icon is still present, from the Dock via the Reopen event).
fn hide_from_dock(window: &tauri::Window) {
    // Clear any miniaturized state so the next show is a clean full window.
    let _ = window.unminimize();
    let _ = window.hide();
    #[cfg(target_os = "macos")]
    let _ = window
        .app_handle()
        .set_activation_policy(tauri::ActivationPolicy::Accessory);
}

// The UI's "Quit" button calls this to actually terminate the app. Closing the
// window (X) only hides it (see the window-event handler), so quitting is an
// explicit action from the UI button or the tray menu — never a side effect of
// closing the panel.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
}

// Show the window + Dock icon. The frontend calls this (rather than the JS
// window API) so every show path goes through the one place that flips the
// macOS activation policy back to Regular.
#[tauri::command]
fn show_window(app: tauri::AppHandle) {
    show_main(&app);
}

// The UI pushes the "minimize into Dock" preference here (on startup and on
// every toggle) so the window-event handler can read it without touching the
// frontend's localStorage.
#[tauri::command]
fn set_minimize_to_dock(state: tauri::State<DockPrefs>, enabled: bool) {
    state.minimize_to_dock.store(enabled, Ordering::Relaxed);
}

// The React UI computes the active profile's worst live-session context fill
// (one number, own account only — never a per-profile list) and pushes it here
// so the menu-bar icon's tooltip reflects it. Best-effort: a missing tray icon
// is a silent no-op, never an error to the UI.
#[tauri::command]
fn set_tray_tooltip(app: tauri::AppHandle, text: String) {
    if let Some(tray) = app.tray_by_id("main-tray") {
        let _ = tray.set_tooltip(Some(text));
    }
}

// A GUI launched from Finder / the menu bar inherits a minimal PATH
// (`/usr/bin:/bin:/usr/sbin:/sbin`) — not the user's shell PATH — so the
// `agent-switch` binary (npm-linked or Homebrew-installed) is unreachable and
// every CLI call fails. Recover the real PATH once at startup, before any tray
// command runs. No-op on Windows, where GUI apps already inherit the full PATH.
//
// An INTERACTIVE login shell (`-ilc`) is required: many setups (Homebrew,
// version managers) export PATH from `.zshrc`/`.bashrc`, not the login-only
// profile, so a non-interactive `-lc` misses them. Without a TTY the shell
// skips prompt rendering, so stdout stays clean. A curated fallback is appended
// unconditionally in case the shell recovery yields nothing usable.
#[cfg(unix)]
fn recover_user_path() {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());
    let recovered = std::process::Command::new(&shell)
        .args(["-ilc", "printf %s \"$PATH\""])
        .output()
        .ok()
        .filter(|o| o.status.success())
        .and_then(|o| String::from_utf8(o.stdout).ok())
        .map(|p| p.trim().to_string())
        .filter(|p| !p.is_empty())
        .unwrap_or_else(|| std::env::var("PATH").unwrap_or_default());

    let home = std::env::var("HOME").unwrap_or_default();
    let fallbacks = [
        "/opt/homebrew/bin".to_string(),
        "/usr/local/bin".to_string(),
        format!("{home}/.npm-global/bin"),
        format!("{home}/.local/bin"),
    ];
    // Duplicates in PATH are harmless; the fallback only matters when the shell
    // recovery came up short.
    let path = std::iter::once(recovered)
        .chain(fallbacks)
        .filter(|p| !p.is_empty())
        .collect::<Vec<_>>()
        .join(":");
    std::env::set_var("PATH", path);
}

fn main() {
    #[cfg(unix)]
    recover_user_path();

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Desktop notifications (usage-fetch failures, successful auto-switches).
        // The GUI falls back to its in-window bell/flyout when permission is denied.
        .plugin(tauri_plugin_notification::init())
        // Launch-at-login toggle (Settings → General). LaunchAgent on macOS.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .manage(pty::PtyState::default())
        .manage(DockPrefs::default())
        .invoke_handler(tauri::generate_handler![
            quit,
            show_window,
            set_minimize_to_dock,
            set_tray_tooltip,
            pty::term_open,
            pty::term_write,
            pty::term_resize,
            pty::term_close
        ])
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Closing (red X) never quits — it hides the window and drops
                // the Dock icon. The tray keeps the app alive; quitting is
                // explicit (UI button / tray menu).
                WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    hide_from_dock(window);
                }
                // Minimizing (yellow) with "minimize into Dock" OFF (default)
                // behaves like closing: the app leaves the Dock. With it ON, do
                // nothing and let macOS minimize into the Dock natively. macOS
                // emits no minimize event, so detect it on focus-loss via
                // is_minimized() (a plain focus loss — clicking another app —
                // is not minimized, so it is ignored). macOS only: the Dock
                // model does not apply to the Windows/Linux taskbar.
                #[cfg(target_os = "macos")]
                WindowEvent::Focused(false) => {
                    let minimize_to_dock = window
                        .state::<DockPrefs>()
                        .minimize_to_dock
                        .load(Ordering::Relaxed);
                    if !minimize_to_dock && window.is_minimized().unwrap_or(false) {
                        hide_from_dock(window);
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            // Start with no Dock icon (menu-bar only); a Dock presence appears
            // the moment the window is shown (show_main → Regular). An
            // autostart/login launch that never opens a window stays Dock-less.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let show = MenuItem::with_id(app, "show", "Show agent-switch", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;

            // Menu-bar icon: a monochrome template image (opaque body, arrows
            // cut out). `icon_as_template(true)` lets macOS tint it black/white
            // to match the other menu-bar icons. The colored bundle icon stays
            // for the Dock / installer.
            let tray_icon = tauri::image::Image::from_bytes(include_bytes!("../icons/tray.png"))?;

            TrayIconBuilder::with_id("main-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("agent-switch")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "show" => show_main(app),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, .. } = event {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running agent-switch GUI");

    app.run(|_app_handle, _event| {
        // macOS: clicking the Dock icon when no window is visible re-shows it.
        #[cfg(target_os = "macos")]
        if let tauri::RunEvent::Reopen { .. } = _event {
            show_main(_app_handle);
        }
    });
}
