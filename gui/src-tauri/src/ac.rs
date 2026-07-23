//! agent-config local-server integration: discovery, lifecycle, and the
//! loopback API channel (roadmap: road-to-ac-embedded-settings, Phase 1).
//!
//! All AC API traffic goes through these commands — the webview never talks
//! HTTP itself. A Rust-side request sends no Origin header, so AC's Origin
//! allow-list (which checks browser-issued requests only) is skipped by
//! design; a fetch() from the webview (Origin `tauri://localhost`) would be
//! 403'd. Host resolves to `127.0.0.1:<port>`, which passes AC's Host
//! allow-list, and the Bearer token passes its `/api/*` gate.
//!
//! Discovery reads AC's discovery file only — never port-scanning
//! 41000–41999, which would race with other users' servers. The bearer token
//! is re-read from its 0600 file on every request (it is fresh per server
//! process, so any respawn rotates it), never cached across calls, never
//! logged, never placed in argv.

use std::fs;
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const DISCOVERY_FILE: &str = "local-server.json";
const TOKEN_FILE: &str = "local-server.token";

/// Bounded liveness probe: a healthy loopback server answers in milliseconds.
const LIVENESS_TIMEOUT: Duration = Duration::from_secs(5);
/// How long `ac_ensure` waits for a spawned server to write its discovery
/// file and answer an authed ping before failing loudly.
const SPAWN_WAIT: Duration = Duration::from_secs(15);
const SPAWN_POLL_INTERVAL: Duration = Duration::from_millis(250);
/// Per-poll ping timeout during spawn wait (connect-refused returns instantly
/// while the server boots, so polls stay cheap).
const SPAWN_POLL_PING_TIMEOUT: Duration = Duration::from_secs(1);
/// Graceful-shutdown POST budget on the app's exit path.
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
/// TCP connect probe used to tell "port bound but not answering" (wedged)
/// from "nothing listening" (stale discovery file).
const PORT_PROBE_TIMEOUT: Duration = Duration::from_secs(1);

/// Discovery status of the agent-config local server.
#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AcStatus {
    /// No discovery file and no `agent-config` binary on PATH.
    NotInstalled,
    /// Installed but no live server (missing/stale discovery file, dead pid,
    /// unbound port, or a responding process that rejects the token file —
    /// i.e. not the recorded server).
    NotRunning,
    /// Authed ping answered 200. `version` comes from the ping body when AC
    /// includes one.
    Live {
        port: u16,
        pid: u32,
        version: Option<String>,
    },
    /// Recorded pid is alive and the port is bound, but the ping times out.
    /// Never killed silently — see `ac_force_restart`.
    Wedged { pid: u32, port: u16 },
}

/// Typed command errors; the TS side switches on `kind`.
#[derive(Serialize, Clone, Debug)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum AcError {
    NotInstalled,
    NotRunning,
    Wedged {
        pid: u32,
    },
    /// The spawned process failed or exited before serving; carries the exit
    /// code and captured stderr so the failure is actionable.
    SpawnFailed {
        exit_code: Option<i32>,
        stderr: String,
    },
    /// Spawn looked alive but never became discoverable within the wait
    /// budget; the half-started process was killed (no orphans).
    StartTimeout {
        waited_ms: u64,
        exit_code: Option<i32>,
        stderr: String,
    },
    /// Still 401 after the one automatic re-discover + token re-read cycle —
    /// the server was restarted externally; the caller rebuilds its view.
    TokenRotated,
    TokenUnreadable {
        message: String,
    },
    Request {
        message: String,
    },
}

/// Response of a loopback API call. Non-2xx statuses are passed through (the
/// TS side decides what a 404/422 means); only transport-level failures and
/// the post-recovery 401 become errors.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApiResponse {
    pub status: u16,
    pub body: String,
}

/// Ownership bookkeeping: whether AS spawned (or force-restarted into) the
/// current server, and the discovery pid recorded at that moment. A server AS
/// merely found is never shut down (the user may have it open in a browser).
#[derive(Default, Clone, Copy, Debug)]
struct Owned {
    spawned: bool,
    pid: Option<u32>,
}

#[derive(Default, Clone)]
pub struct AcState(Arc<Mutex<Owned>>);

#[derive(Deserialize, Clone, Debug)]
struct DiscoveryInfo {
    pid: u32,
    port: u16,
    // The file also carries `url` and `startedAt` — intentionally unused:
    // requests always target 127.0.0.1:<port>, so a tampered url can never
    // redirect traffic (and the token) off loopback.
}

fn config_dir() -> PathBuf {
    let home = if cfg!(windows) {
        std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME"))
    } else {
        std::env::var("HOME")
    }
    .unwrap_or_default();
    Path::new(&home).join(".event4u").join("agent-config")
}

fn read_discovery(dir: &Path) -> Option<DiscoveryInfo> {
    let raw = fs::read_to_string(dir.join(DISCOVERY_FILE)).ok()?;
    let info: DiscoveryInfo = serde_json::from_str(&raw).ok()?;
    (info.pid != 0 && info.port != 0).then_some(info)
}

fn read_token(dir: &Path) -> Result<String, AcError> {
    // Re-read on every use: the token is fresh per server process, so any
    // respawn rotates it. Never cached beyond the single call, never logged.
    match fs::read_to_string(dir.join(TOKEN_FILE)) {
        Ok(s) => Ok(s.trim().to_string()),
        Err(e) => Err(AcError::TokenUnreadable {
            message: e.to_string(),
        }),
    }
}

fn binary_on_path() -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    // npm installs a `.cmd` shim on Windows, a shebang script elsewhere.
    let names: &[&str] = if cfg!(windows) {
        &["agent-config.cmd", "agent-config.exe", "agent-config"]
    } else {
        &["agent-config"]
    };
    std::env::split_paths(&path).any(|dir| names.iter().any(|n| dir.join(n).is_file()))
}

#[cfg(unix)]
fn unix_kill(pid: u32, sig: i32) -> i32 {
    // Direct syscall via the always-linked libc symbol — avoids both a libc
    // crate dependency and a subprocess per liveness poll.
    extern "C" {
        fn kill(pid: i32, sig: i32) -> i32;
    }
    unsafe { kill(pid as i32, sig) }
}

#[cfg(unix)]
fn pid_alive(pid: u32) -> bool {
    // Signal 0 probes existence without delivering anything. EPERM (1) still
    // means the pid exists (another user's process).
    if unix_kill(pid, 0) == 0 {
        return true;
    }
    std::io::Error::last_os_error().raw_os_error() == Some(1)
}

#[cfg(unix)]
fn terminate_pid(pid: u32) {
    let _ = unix_kill(pid, 15); // SIGTERM
}

#[cfg(unix)]
fn force_kill_pid(pid: u32) {
    let _ = unix_kill(pid, 9); // SIGKILL
}

#[cfg(windows)]
fn pid_alive(pid: u32) -> bool {
    Command::new("tasklist")
        .args(["/FI", &format!("PID eq {pid}"), "/NH"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains(&pid.to_string()))
        .unwrap_or(false)
}

#[cfg(windows)]
fn terminate_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/PID", &pid.to_string()])
        .status();
}

#[cfg(windows)]
fn force_kill_pid(pid: u32) {
    let _ = Command::new("taskkill")
        .args(["/F", "/PID", &pid.to_string()])
        .status();
}

fn wait_pid_death(pid: u32, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if !pid_alive(pid) {
            return true;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    !pid_alive(pid)
}

fn http_agent(timeout: Duration) -> ureq::Agent {
    ureq::AgentBuilder::new().timeout(timeout).build()
}

fn port_bound(port: u16, timeout: Duration) -> bool {
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

enum Probe {
    /// 200 on the authed ping — this is our server.
    Ok {
        version: Option<String>,
    },
    Unauthorized,
    /// Responded, but not with AC's ping shape — a foreign process owns the
    /// port; the discovery file is stale.
    OtherStatus,
    /// Port bound but no HTTP answer within the timeout — the wedged case.
    PortBoundNoReply,
    ConnectFailed,
}

fn probe(port: u16, token: &str, timeout: Duration) -> Probe {
    let url = format!("http://127.0.0.1:{port}/api/v1/ping");
    match http_agent(timeout)
        .get(&url)
        .set("Authorization", &format!("Bearer {token}"))
        .call()
    {
        Ok(resp) => Probe::Ok {
            version: extract_version(resp),
        },
        Err(ureq::Error::Status(401, _)) => Probe::Unauthorized,
        Err(ureq::Error::Status(_, _)) => Probe::OtherStatus,
        Err(ureq::Error::Transport(_)) => {
            if port_bound(port, PORT_PROBE_TIMEOUT.min(timeout)) {
                Probe::PortBoundNoReply
            } else {
                Probe::ConnectFailed
            }
        }
    }
}

fn extract_version(resp: ureq::Response) -> Option<String> {
    let body = resp.into_string().ok()?;
    let v: serde_json::Value = serde_json::from_str(&body).ok()?;
    v.get("version")?.as_str().map(str::to_owned)
}

/// Classify the server state from the discovery dir. `binary_present` is
/// injected (rather than read from PATH here) so classification is
/// deterministic under test.
fn discover_at(dir: &Path, timeout: Duration, binary_present: bool) -> AcStatus {
    let Some(info) = read_discovery(dir) else {
        return if binary_present {
            AcStatus::NotRunning
        } else {
            AcStatus::NotInstalled
        };
    };
    // The discovery file is only a claim — stale after a crash. Pid first.
    if !pid_alive(info.pid) {
        return AcStatus::NotRunning;
    }
    let token = read_token(dir).unwrap_or_default();
    match probe(info.port, &token, timeout) {
        Probe::Ok { version } => AcStatus::Live {
            port: info.port,
            pid: info.pid,
            version,
        },
        // A responding process that rejects the token written next to the
        // discovery file is not the recorded server (the token is
        // per-process): stale file, foreign port owner. Never a kill
        // candidate, never live.
        Probe::Unauthorized | Probe::OtherStatus => AcStatus::NotRunning,
        Probe::PortBoundNoReply => AcStatus::Wedged {
            pid: info.pid,
            port: info.port,
        },
        Probe::ConnectFailed => AcStatus::NotRunning,
    }
}

// ---- loopback API -----------------------------------------------------------

fn validate_request(method: &str, path: &str) -> Result<(), AcError> {
    const METHODS: [&str; 5] = ["GET", "POST", "PUT", "PATCH", "DELETE"];
    if !METHODS.contains(&method) {
        return Err(AcError::Request {
            message: format!("unsupported method: {method}"),
        });
    }
    // Only AC's token-gated API surface is reachable from the webview, and a
    // path is rejected before it can smuggle CR/LF or spaces into the
    // request line.
    if !path.starts_with("/api/") || path.chars().any(|c| c.is_ascii_control() || c == ' ') {
        return Err(AcError::Request {
            message: "path must start with /api/ and contain no control characters".into(),
        });
    }
    Ok(())
}

fn api_attempt(
    dir: &Path,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
) -> Result<ApiResponse, AcError> {
    let info = read_discovery(dir).ok_or(AcError::NotRunning)?;
    let token = read_token(dir)?;
    // Always loopback: the discovery file's port is trusted, its url is not.
    let url = format!("http://127.0.0.1:{}{}", info.port, path);
    let req = http_agent(timeout)
        .request(method, &url)
        .set("Authorization", &format!("Bearer {token}"));
    let result = match body {
        Some(b) => req.set("Content-Type", "application/json").send_string(b),
        None => req.call(),
    };
    match result {
        Ok(resp) => Ok(ApiResponse {
            status: resp.status(),
            body: resp.into_string().unwrap_or_default(),
        }),
        Err(ureq::Error::Status(code, resp)) => Ok(ApiResponse {
            status: code,
            body: resp.into_string().unwrap_or_default(),
        }),
        // Transport errors carry at most the URL — never the Authorization
        // header, so the token cannot leak through this message.
        Err(ureq::Error::Transport(t)) => Err(AcError::Request {
            message: t.to_string(),
        }),
    }
}

fn api_call_at(
    dir: &Path,
    method: &str,
    path: &str,
    body: Option<&str>,
    timeout: Duration,
) -> Result<ApiResponse, AcError> {
    validate_request(method, path)?;
    let first = api_attempt(dir, method, path, body, timeout)?;
    if first.status != 401 {
        return Ok(first);
    }
    // 401 means the token rotated under us (external restart): one automatic
    // recovery cycle — re-read discovery + token, retry once.
    let second = api_attempt(dir, method, path, body, timeout)?;
    if second.status == 401 {
        return Err(AcError::TokenRotated);
    }
    Ok(second)
}

// ---- spawn / ensure ---------------------------------------------------------

static STDERR_SEQ: AtomicU64 = AtomicU64::new(0);

struct SpawnHandle {
    child: Child,
    stderr_path: PathBuf,
}

#[cfg(windows)]
fn server_command() -> Command {
    // npm installs agent-config as a .cmd shim, which CreateProcess cannot
    // launch directly — go through cmd.exe.
    let mut c = Command::new("cmd");
    c.args(["/C", "agent-config", "ui:serve", "--no-open"]);
    c
}

#[cfg(not(windows))]
fn server_command() -> Command {
    let mut c = Command::new("agent-config");
    c.args(["ui:serve", "--no-open"]);
    c
}

fn spawn_server() -> Result<SpawnHandle, AcError> {
    // stderr goes to a temp file, not a pipe: the server outlives this call,
    // and holding a pipe read-end would EPIPE its logging once dropped; the
    // file also survives for the early-exit diagnosis below.
    let stderr_path = std::env::temp_dir().join(format!(
        "agent-switch-ac-spawn-{}-{}.log",
        std::process::id(),
        STDERR_SEQ.fetch_add(1, Ordering::Relaxed)
    ));
    let stderr = fs::File::create(&stderr_path).map_err(|e| AcError::Request {
        message: format!("stderr capture file: {e}"),
    })?;

    let mut cmd = server_command();
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(stderr);
    // Inherit the recovered GUI PATH (see recover_user_path in main.rs) so the
    // npm-installed binary resolves from a Finder-launched app.
    if let Ok(path) = std::env::var("PATH") {
        cmd.env("PATH", path);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Own process group: the server must not die with AS's session; its
        // end is explicit (ac_release) or AC's own 30-min idle watchdog.
        cmd.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    }
    match cmd.spawn() {
        Ok(child) => Ok(SpawnHandle { child, stderr_path }),
        Err(e) => {
            let _ = fs::remove_file(&stderr_path);
            if e.kind() == std::io::ErrorKind::NotFound {
                Err(AcError::NotInstalled)
            } else {
                Err(AcError::SpawnFailed {
                    exit_code: None,
                    stderr: e.to_string(),
                })
            }
        }
    }
}

fn read_stderr_tail(path: &Path) -> String {
    let s = fs::read_to_string(path).unwrap_or_default();
    let s = s.trim();
    const MAX: usize = 8 * 1024;
    if s.len() <= MAX {
        return s.to_string();
    }
    let mut start = s.len() - MAX;
    while !s.is_char_boundary(start) {
        start += 1;
    }
    format!("…{}", &s[start..])
}

fn spawn_and_wait(dir: &Path, state: &AcState) -> Result<AcStatus, AcError> {
    let mut handle = spawn_server()?;
    let started = Instant::now();
    let outcome = loop {
        if let Ok(Some(status)) = handle.child.try_wait() {
            break Err(AcError::SpawnFailed {
                exit_code: status.code(),
                stderr: read_stderr_tail(&handle.stderr_path),
            });
        }
        if let AcStatus::Live { port, pid, version } =
            discover_at(dir, SPAWN_POLL_PING_TIMEOUT, true)
        {
            break Ok(AcStatus::Live { port, pid, version });
        }
        if started.elapsed() >= SPAWN_WAIT {
            // Never leave a half-started process behind: we spawned it, it
            // never became live — kill and reap before failing loudly.
            let _ = handle.child.kill();
            let exit_code = handle.child.wait().ok().and_then(|s| s.code());
            break Err(AcError::StartTimeout {
                waited_ms: SPAWN_WAIT.as_millis() as u64,
                exit_code,
                stderr: read_stderr_tail(&handle.stderr_path),
            });
        }
        std::thread::sleep(SPAWN_POLL_INTERVAL);
    };
    let SpawnHandle { child, stderr_path } = handle;
    if let Ok(AcStatus::Live { pid, .. }) = &outcome {
        {
            let mut owned = state.0.lock().unwrap();
            owned.spawned = true;
            owned.pid = Some(*pid);
        }
        // Unix zombie hygiene: reap the direct child when it eventually exits
        // (idle watchdog or shutdown beacon); on the failure branches it was
        // already reaped above.
        std::thread::spawn(move || {
            let mut child = child;
            let _ = child.wait();
        });
    }
    let _ = fs::remove_file(&stderr_path);
    outcome
}

fn ensure(state: &AcState) -> Result<AcStatus, AcError> {
    let dir = config_dir();
    match discover_at(&dir, LIVENESS_TIMEOUT, binary_on_path()) {
        live @ AcStatus::Live { .. } => Ok(live),
        // Never silently kill a wedged server — force-restart is a separate,
        // user-consented command.
        AcStatus::Wedged { pid, .. } => Err(AcError::Wedged { pid }),
        AcStatus::NotInstalled => Err(AcError::NotInstalled),
        AcStatus::NotRunning => spawn_and_wait(&dir, state),
    }
}

fn force_restart(state: &AcState) -> Result<AcStatus, AcError> {
    let dir = config_dir();
    match discover_at(&dir, LIVENESS_TIMEOUT, binary_on_path()) {
        // Recovered on its own — nothing to kill, nothing to spawn.
        live @ AcStatus::Live { .. } => Ok(live),
        AcStatus::NotInstalled => Err(AcError::NotInstalled),
        AcStatus::NotRunning => spawn_and_wait(&dir, state),
        AcStatus::Wedged { pid, .. } => {
            terminate_pid(pid);
            if !wait_pid_death(pid, Duration::from_secs(3)) {
                force_kill_pid(pid);
                if !wait_pid_death(pid, Duration::from_secs(2)) {
                    return Err(AcError::Request {
                        message: format!("could not terminate wedged agent-config (pid {pid})"),
                    });
                }
            }
            // The killed server can't clean its own discovery file up.
            let _ = fs::remove_file(dir.join(DISCOVERY_FILE));
            spawn_and_wait(&dir, state)
        }
    }
}

/// Which pid (if any) release may act on: only a server AS spawned, and only
/// while the discovery file still points at that same pid — an externally
/// restarted server is not ours to touch.
fn release_target(owned: Owned, current: Option<&DiscoveryInfo>) -> Option<u32> {
    if !owned.spawned {
        return None;
    }
    let info = current?;
    (Some(info.pid) == owned.pid).then_some(info.pid)
}

/// Shut the server down if (and only if) AS spawned it. Called from the app's
/// exit path (RunEvent::Exit) and from the `ac_release` command; a found-only
/// server is left running.
pub fn release(state: &AcState) {
    let owned = *state.0.lock().unwrap();
    let dir = config_dir();
    let current = read_discovery(&dir);
    let Some(pid) = release_target(owned, current.as_ref()) else {
        return;
    };
    let port = current.map(|i| i.port).unwrap_or_default();
    let token = read_token(&dir).unwrap_or_default();
    // Graceful first: the shutdown beacon lets AC remove its own discovery
    // file on the way out.
    let graceful = http_agent(SHUTDOWN_TIMEOUT)
        .post(&format!("http://127.0.0.1:{port}/api/v1/shutdown"))
        .set("Authorization", &format!("Bearer {token}"))
        .call()
        .is_ok();
    if graceful && wait_pid_death(pid, Duration::from_secs(2)) {
        return;
    }
    if pid_alive(pid) {
        terminate_pid(pid);
        let _ = wait_pid_death(pid, Duration::from_secs(2));
    }
    // SIGTERM path: node exits without its graceful cleanup — drop the now-
    // stale discovery file so the next reader doesn't chase a dead pid.
    if !pid_alive(pid) {
        if let Some(now) = read_discovery(&dir) {
            if now.pid == pid {
                let _ = fs::remove_file(dir.join(DISCOVERY_FILE));
            }
        }
    }
}

// ---- Tauri commands ---------------------------------------------------------
// All commands run their blocking IO (file reads, HTTP with multi-second
// timeouts, spawn waits) on the blocking pool so the main thread and the async
// runtime workers never stall.

async fn run_blocking<T: Send + 'static>(
    f: impl FnOnce() -> Result<T, AcError> + Send + 'static,
) -> Result<T, AcError> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| AcError::Request {
            message: e.to_string(),
        })?
}

#[tauri::command]
pub async fn ac_discover() -> Result<AcStatus, AcError> {
    run_blocking(|| {
        Ok(discover_at(
            &config_dir(),
            LIVENESS_TIMEOUT,
            binary_on_path(),
        ))
    })
    .await
}

#[tauri::command]
pub async fn ac_ensure(state: tauri::State<'_, AcState>) -> Result<AcStatus, AcError> {
    let st = state.inner().clone();
    run_blocking(move || ensure(&st)).await
}

/// Force-restart a wedged server (recorded pid alive, ping dead): kill the
/// recorded pid, respawn, take ownership. ONLY for the wedged case — the UI
/// (a later phase) invokes this exclusively after explicit user consent; AS
/// never silently kills a process it did not spawn. If the server recovered
/// in the meantime it is returned as-is, nothing is killed.
#[tauri::command]
pub async fn ac_force_restart(state: tauri::State<'_, AcState>) -> Result<AcStatus, AcError> {
    let st = state.inner().clone();
    run_blocking(move || force_restart(&st)).await
}

#[tauri::command]
pub async fn ac_api(
    method: String,
    path: String,
    body: Option<String>,
) -> Result<ApiResponse, AcError> {
    run_blocking(move || {
        api_call_at(
            &config_dir(),
            &method,
            &path,
            body.as_deref(),
            LIVENESS_TIMEOUT,
        )
    })
    .await
}

#[tauri::command]
pub async fn ac_release(state: tauri::State<'_, AcState>) -> Result<(), AcError> {
    let st = state.inner().clone();
    run_blocking(move || {
        release(&st);
        Ok(())
    })
    .await
}

/// Label of the separate settings window (council-decided transport: a stable
/// `WebviewWindow`, never an iframe — AC ships `frame-ancestors 'none'` — and
/// never the unstable child-webview API).
pub const SETTINGS_WINDOW_LABEL: &str = "ac-settings";

/// Build the settings-window URL. The token is placed here, in Rust — it never
/// enters the main webview's JS context, is never logged, and AC's SPA strips
/// it from the URL after boot (AC-side hardening).
fn settings_url(port: u16, theme: &str, token: &str) -> String {
    let theme = if theme == "light" { "light" } else { "dark" };
    format!("http://127.0.0.1:{port}/#/settings?embed=1&theme={theme}&token={token}")
}

/// Open (or focus) the embedded agent-config settings window: ensure a live
/// server, then load AC's real UI top-level in a separate `WebviewWindow`.
/// The window gets NO `remote.urls` capability — the AC page has zero Tauri
/// IPC. It positions relative to the main window (never the primary monitor),
/// closes with it, and emits `ac-settings-closed` to the main webview on
/// destroy so the keepalive stops.
#[tauri::command]
pub async fn ac_open_settings_window(
    app: tauri::AppHandle,
    state: tauri::State<'_, AcState>,
    theme: String,
    profile: Option<String>,
) -> Result<AcStatus, AcError> {
    use tauri::{Emitter, Manager};

    let st = state.inner().clone();
    let status = run_blocking(move || ensure(&st)).await?;
    let port = match status {
        AcStatus::Live { port, .. } => port,
        // ensure() only returns Live or an error, but stay total.
        _ => {
            return Err(AcError::Request {
                message: "agent-config server is not live".into(),
            })
        }
    };

    if let Some(existing) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = existing.set_focus();
        return Ok(status);
    }

    let token = run_blocking(move || read_token(&config_dir())).await?;
    let url = settings_url(port, &theme, &token)
        .parse::<tauri::Url>()
        .map_err(|e| AcError::Request {
            message: format!("settings url failed to parse: {e}"),
        })?;
    let title = match profile.as_deref() {
        Some(p) => format!("agent-config — Settings · {p}"),
        None => "agent-config — Settings".to_string(),
    };

    let win = tauri::WebviewWindowBuilder::new(
        &app,
        SETTINGS_WINDOW_LABEL,
        tauri::WebviewUrl::External(url),
    )
    .title(title)
    .inner_size(980.0, 640.0)
    .min_inner_size(640.0, 480.0)
    .build()
    .map_err(|e| AcError::Request {
        message: format!("settings window failed to open: {e}"),
    })?;

    // Position relative to the main window (Tauri's center() targets the
    // primary monitor, which is the wrong monitor on multi-display setups).
    if let Some(main) = app.get_webview_window("main") {
        if let Ok(pos) = main.outer_position() {
            let _ = win.set_position(tauri::PhysicalPosition::new(pos.x + 48, pos.y + 48));
        }
    }

    let app_for_event = app.clone();
    win.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            let _ = app_for_event.emit_to("main", "ac-settings-closed", ());
        }
    });

    Ok(status)
}

/// Close the settings window when the main window closes/hides — the satellite
/// never outlives the surface that opened it. Called from main.rs's
/// CloseRequested handler; a no-op when the window is not open.
pub fn close_settings_window(app: &tauri::AppHandle) {
    use tauri::Manager;
    if let Some(win) = app.get_webview_window(SETTINGS_WINDOW_LABEL) {
        let _ = win.close();
    }
}

/// The permanent "Open in browser" escape hatch: ensure a live server, then
/// open AC's own browser bootstrap URL (`/?token=…` — the exact shape AC
/// writes into its discovery file for this purpose) in the system browser.
/// The URL is built and opened entirely in Rust so the token never enters the
/// webview's JS context.
#[tauri::command]
pub async fn ac_open_in_browser(
    app: tauri::AppHandle,
    state: tauri::State<'_, AcState>,
) -> Result<(), AcError> {
    use tauri_plugin_shell::ShellExt;

    let st = state.inner().clone();
    let status = run_blocking(move || ensure(&st)).await?;
    let port = match status {
        AcStatus::Live { port, .. } => port,
        _ => {
            return Err(AcError::Request {
                message: "agent-config server is not live".into(),
            })
        }
    };
    let token = run_blocking(move || read_token(&config_dir())).await?;
    // shell.open is deprecated upstream in favour of tauri-plugin-opener; the
    // whole app (webview side included) standardises on plugin-shell, so a
    // second opener dependency is not worth one call site.
    #[allow(deprecated)]
    app.shell()
        .open(format!("http://127.0.0.1:{port}/?token={token}"), None)
        .map_err(|e| AcError::Request {
            message: format!("browser open failed: {e}"),
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;

    static DIR_SEQ: AtomicU64 = AtomicU64::new(0);
    const FAST: Duration = Duration::from_millis(400);

    fn fixture_dir() -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "as-ac-test-{}-{}",
            std::process::id(),
            DIR_SEQ.fetch_add(1, Ordering::Relaxed)
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn write_discovery(dir: &Path, pid: u32, port: u16) {
        fs::write(
            dir.join(DISCOVERY_FILE),
            format!(
                r#"{{"pid":{pid},"port":{port},"url":"http://127.0.0.1:{port}","startedAt":"2026-07-23T00:00:00Z"}}"#
            ),
        )
        .unwrap();
    }

    fn write_token(dir: &Path, token: &str) {
        fs::write(dir.join(TOKEN_FILE), token).unwrap();
    }

    /// Minimal loopback HTTP stub: `handler` gets the request head (request
    /// line + headers) and returns the full response, or None to drop the
    /// connection without replying (after sleeping, for the wedged case).
    fn stub_server<F>(handler: F) -> u16
    where
        F: Fn(&str) -> Option<String> + Send + 'static,
    {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { continue };
                let mut head = Vec::new();
                let mut byte = [0u8; 1];
                while !head.ends_with(b"\r\n\r\n") {
                    match stream.read(&mut byte) {
                        Ok(1) => head.push(byte[0]),
                        _ => break,
                    }
                }
                let head = String::from_utf8_lossy(&head).into_owned();
                // Drain the request body before responding: closing a socket
                // with unread data sends a RST that can clobber the response
                // in the client's receive buffer.
                if let Some(len) = head
                    .lines()
                    .find_map(|l| l.strip_prefix("Content-Length: "))
                    .and_then(|v| v.trim().parse::<usize>().ok())
                {
                    let mut body = vec![0u8; len];
                    let _ = stream.read_exact(&mut body);
                }
                if let Some(resp) = handler(&head) {
                    let _ = stream.write_all(resp.as_bytes());
                }
            }
        });
        port
    }

    fn ok_json(body: &str) -> String {
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    fn unauthorized() -> String {
        "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string()
    }

    #[test]
    fn discovery_parsing_tolerates_missing_and_garbage_files() {
        let dir = fixture_dir();
        assert!(read_discovery(&dir).is_none()); // missing file
        fs::write(dir.join(DISCOVERY_FILE), "not json").unwrap();
        assert!(read_discovery(&dir).is_none()); // garbage
        fs::write(dir.join(DISCOVERY_FILE), r#"{"port":41000}"#).unwrap();
        assert!(read_discovery(&dir).is_none()); // missing pid
        fs::write(dir.join(DISCOVERY_FILE), r#"{"pid":0,"port":41000}"#).unwrap();
        assert!(read_discovery(&dir).is_none()); // nonsense pid
        write_discovery(&dir, 4321, 41000);
        let info = read_discovery(&dir).unwrap();
        assert_eq!((info.pid, info.port), (4321, 41000));
    }

    #[test]
    fn discover_missing_file_maps_to_installed_state() {
        let dir = fixture_dir();
        assert_eq!(discover_at(&dir, FAST, true), AcStatus::NotRunning);
        assert_eq!(discover_at(&dir, FAST, false), AcStatus::NotInstalled);
    }

    #[test]
    fn discover_classifies_stale_pid_as_not_running() {
        let dir = fixture_dir();
        write_discovery(&dir, 0x3FFF_FFFF, 41000); // a pid no OS hands out
        write_token(&dir, "tok");
        assert_eq!(discover_at(&dir, FAST, true), AcStatus::NotRunning);
    }

    #[test]
    fn discover_live_server_with_version() {
        let dir = fixture_dir();
        let port = stub_server(|head| {
            Some(if head.contains("Bearer tok-1") {
                ok_json(r#"{"ok":true,"version":"9.7.0"}"#)
            } else {
                unauthorized()
            })
        });
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "tok-1");
        assert_eq!(
            discover_at(&dir, FAST, true),
            AcStatus::Live {
                port,
                pid: std::process::id(),
                version: Some("9.7.0".into())
            }
        );
    }

    #[test]
    fn discover_wedged_when_pid_alive_but_ping_times_out() {
        let dir = fixture_dir();
        let port = stub_server(|_| {
            std::thread::sleep(Duration::from_secs(2));
            None
        });
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "tok");
        assert_eq!(
            discover_at(&dir, Duration::from_millis(250), true),
            AcStatus::Wedged {
                pid: std::process::id(),
                port
            }
        );
    }

    #[test]
    fn discover_unbound_port_is_not_running() {
        let dir = fixture_dir();
        // Bind to grab a free port number, then drop the listener.
        let port = TcpListener::bind("127.0.0.1:0")
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "tok");
        assert_eq!(discover_at(&dir, FAST, true), AcStatus::NotRunning);
    }

    #[test]
    fn discover_persistent_401_is_not_running_never_wedged() {
        // A responding server that rejects our token is someone else's —
        // never a kill candidate (wedged) and never live.
        let dir = fixture_dir();
        let port = stub_server(|_| Some(unauthorized()));
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "wrong");
        assert_eq!(discover_at(&dir, FAST, true), AcStatus::NotRunning);
    }

    #[test]
    fn api_call_recovers_once_from_token_rotation() {
        let dir = fixture_dir();
        let token_path = dir.join(TOKEN_FILE);
        let port = stub_server(move |head| {
            if head.contains("Bearer fresh") {
                Some(ok_json(r#"{"ok":true}"#))
            } else {
                // Simulate an external restart rotating the token between the
                // first attempt and the recovery re-read.
                fs::write(&token_path, "fresh").unwrap();
                Some(unauthorized())
            }
        });
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "stale");
        let resp = api_call_at(&dir, "GET", "/api/v1/ping", None, FAST).unwrap();
        assert_eq!(resp.status, 200);
    }

    #[test]
    fn api_call_persistent_401_is_token_rotated_error() {
        let dir = fixture_dir();
        let port = stub_server(|_| Some(unauthorized()));
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "stale");
        match api_call_at(&dir, "GET", "/api/v1/ping", None, FAST) {
            Err(AcError::TokenRotated) => {}
            other => panic!("expected TokenRotated, got {other:?}"),
        }
    }

    #[test]
    fn api_call_without_discovery_file_is_not_running() {
        let dir = fixture_dir();
        match api_call_at(&dir, "GET", "/api/v1/ping", None, FAST) {
            Err(AcError::NotRunning) => {}
            other => panic!("expected NotRunning, got {other:?}"),
        }
    }

    #[test]
    fn api_call_rejects_non_api_paths_and_unknown_methods() {
        let dir = fixture_dir();
        assert!(matches!(
            api_call_at(&dir, "GET", "/", None, FAST),
            Err(AcError::Request { .. })
        ));
        assert!(matches!(
            api_call_at(&dir, "GET", "/api/v1/x y", None, FAST),
            Err(AcError::Request { .. })
        ));
        assert!(matches!(
            api_call_at(&dir, "TRACE", "/api/v1/ping", None, FAST),
            Err(AcError::Request { .. })
        ));
    }

    #[test]
    fn api_call_passes_body_and_non_2xx_status_through() {
        let dir = fixture_dir();
        let port = stub_server(|head| {
            if head.starts_with("POST /api/v1/settings") {
                Some(
                    "HTTP/1.1 422 Unprocessable Entity\r\nContent-Length: 9\r\nConnection: close\r\n\r\nbad value"
                        .into(),
                )
            } else {
                Some(ok_json("{}"))
            }
        });
        write_discovery(&dir, std::process::id(), port);
        write_token(&dir, "tok");
        let resp = api_call_at(&dir, "POST", "/api/v1/settings", Some(r#"{"a":1}"#), FAST).unwrap();
        assert_eq!((resp.status, resp.body.as_str()), (422, "bad value"));
    }

    #[test]
    fn release_targets_only_the_server_as_spawned() {
        let found = Owned {
            spawned: false,
            pid: None,
        };
        let spawned = Owned {
            spawned: true,
            pid: Some(1234),
        };
        let current = DiscoveryInfo {
            pid: 1234,
            port: 41000,
        };
        let other = DiscoveryInfo {
            pid: 9999,
            port: 41001,
        };
        // Found, not spawned → never kill (ownership rule).
        assert_eq!(release_target(found, Some(&current)), None);
        // Spawned and still the recorded pid → ours to shut down.
        assert_eq!(release_target(spawned, Some(&current)), Some(1234));
        // Replaced externally since our spawn → hands off.
        assert_eq!(release_target(spawned, Some(&other)), None);
        // Already gone → nothing to do.
        assert_eq!(release_target(spawned, None), None);
    }

    #[test]
    fn settings_url_targets_loopback_and_sanitizes_the_theme() {
        assert_eq!(
            settings_url(41066, "dark", "abc123"),
            "http://127.0.0.1:41066/#/settings?embed=1&theme=dark&token=abc123"
        );
        assert_eq!(
            settings_url(41066, "light", "abc123"),
            "http://127.0.0.1:41066/#/settings?embed=1&theme=light&token=abc123"
        );
        // Anything but "light" collapses to dark — the query is a bounded
        // contract, never a free-form passthrough.
        assert!(settings_url(41066, "weird\"><script>", "t").contains("theme=dark"));
    }
}
