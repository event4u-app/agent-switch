// agent-switch tray/menubar shell. The window hosts the React UI, which drives
// the `agent-switch` CLI via the shell plugin; this Rust side only owns the
// tray icon, the window, and launch-at-login. No profile logic lives here.
#![cfg_attr(all(not(debug_assertions), target_os = "windows"), windows_subsystem = "windows")]

mod pty;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};

fn show_main(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.set_focus();
    }
}

// The UI's "Quit" button calls this to actually terminate the app. Closing the
// window (X) only hides it (see the window-event handler), so quitting is an
// explicit action from the UI button or the tray menu — never a side effect of
// closing the panel.
#[tauri::command]
fn quit(app: tauri::AppHandle) {
    app.exit(0);
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

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        // Launch-at-login toggle (Settings → General). LaunchAgent on macOS.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None::<Vec<&str>>,
        ))
        .manage(pty::PtyState::default())
        .invoke_handler(tauri::generate_handler![
            quit,
            pty::term_open,
            pty::term_write,
            pty::term_resize,
            pty::term_close
        ])
        // Closing the window (X) must only hide it, never quit — the tray keeps
        // the app alive and it is re-shown from the tray. Quitting is explicit
        // (UI button / tray menu).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // Menu-bar utility: no Dock icon and not in the app switcher, so
            // closing/minimizing never leaves a Dock entry behind. The window is
            // reached from the tray, not the Dock.
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

            TrayIconBuilder::new()
                .icon(tray_icon)
                .icon_as_template(true)
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
        .run(tauri::generate_context!())
        .expect("error while running agent-switch GUI");
}
