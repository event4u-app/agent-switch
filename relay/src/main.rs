//! `as-hook` — the hook relay (road-to-agent-switch-v3-central M2).
//!
//! A Claude Code hook runs `as-hook <cli> __hook-event`. The relay reads the
//! hook's stdin, sends it with the hook environment to the engine as one `hook`
//! request, and exits once the engine answers that the event is stored. When no
//! engine answers in time, or it refuses, the relay runs the given CLI command
//! with the same stdin — the 2.x path that writes the ring itself. It always
//! exits 0: a hook must never fail the agent's turn.
//!
//! No dependencies, so it starts in a few milliseconds where Node needs ~45 ms
//! (agents/evidence/hook-relay-latency-2026-11.md).

use std::io::{Read, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

/// Same cap as the engine's request line (src/protocol/messages.ts); the
/// envelope needs room, so a payload near it goes to the CLI instead.
const MAX_PAYLOAD: usize = 60 * 1024;
const ANSWER_TIMEOUT: Duration = Duration::from_millis(1500);

/// The hook environment forwarded to the engine (src/hook-intake.ts HOOK_ENV_KEYS).
const ENV_KEYS: [&str; 7] = [
    "CLAUDE_CONFIG_DIR",
    "CLAUDE_PID",
    "AGENT_SWITCH_PARENT_SESSION",
    "AGENT_SWITCH_PARENT_KIND",
    "AGENT_SWITCH_PARENT_LABEL",
    "AGENT_SWITCH_PARENT_AGENT",
    "AGENT_SWITCH_HOST_PANE",
];

fn json_string(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 2);
    o.push('"');
    for c in s.chars() {
        match c {
            '"' => o.push_str("\\\""),
            '\\' => o.push_str("\\\\"),
            '\n' => o.push_str("\\n"),
            '\r' => o.push_str("\\r"),
            '\t' => o.push_str("\\t"),
            c if (c as u32) < 0x20 => o.push_str(&format!("\\u{:04x}", c as u32)),
            c => o.push(c),
        }
    }
    o.push('"');
    o
}

/// One `hook` request line. `payload` is the hook's stdin, passed through as
/// JSON; a payload that is not JSON makes the engine answer `bad_json`, and the
/// relay falls back.
fn request_line(payload: &str, env: &[(&str, String)]) -> String {
    let env_json: Vec<String> = env.iter().map(|(k, v)| format!("{}:{}", json_string(k), json_string(v))).collect();
    format!(
        "{{\"id\":1,\"op\":\"hook\",\"params\":{{\"payload\":{},\"env\":{{{}}}}}}}\n",
        payload.trim(),
        env_json.join(",")
    )
}

/// The engine said the event is stored. Anything else — an error, a refusal,
/// garbage — is not an acknowledgement.
fn acknowledged(answer: &str) -> bool {
    let a: String = answer.chars().filter(|c| !c.is_whitespace()).collect();
    a.contains("\"ok\":true") && a.contains("\"stored\":true")
}

fn root(get: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if let Some(r) = get("AGENT_SWITCH_HOME").filter(|s| !s.is_empty()) {
        return Some(r);
    }
    let home = get("HOME").filter(|s| !s.is_empty()).or_else(|| get("USERPROFILE").filter(|s| !s.is_empty()))?;
    Some(format!("{}/.agent-switch", home.trim_end_matches(['/', '\\'])))
}

/// Where the engine listens (src/protocol/messages.ts engineAddress).
fn address(windows: bool, get: &dyn Fn(&str) -> Option<String>) -> Option<String> {
    if windows {
        let user = get("USERNAME").or_else(|| get("USER")).unwrap_or_else(|| "user".into());
        let safe: String = user.chars().map(|c| if c.is_ascii_alphanumeric() || "_.-".contains(c) { c } else { '_' }).collect();
        return Some(format!("\\\\.\\pipe\\agent-switch-{}", safe));
    }
    Some(format!("{}/engine.sock", root(get)?.trim_end_matches(['/', '\\'])))
}

#[cfg(unix)]
fn exchange(addr: &str, line: &str) -> std::io::Result<String> {
    let mut s = std::os::unix::net::UnixStream::connect(addr)?;
    s.write_all(line.as_bytes())?;
    read_line(&mut s)
}

/// ERROR_PIPE_BUSY: every listening instance of the pipe is taken. Many hooks at
/// once hit this; the engine opens the next instance within milliseconds.
#[cfg(windows)]
const ERROR_PIPE_BUSY: i32 = 231;

#[cfg(windows)]
fn exchange(addr: &str, line: &str) -> std::io::Result<String> {
    let deadline = std::time::Instant::now() + ANSWER_TIMEOUT;
    let mut p = loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(addr) {
            Ok(p) => break p,
            Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY) && std::time::Instant::now() < deadline => {
                thread::sleep(Duration::from_millis(2))
            }
            Err(e) => return Err(e),
        }
    };
    p.write_all(line.as_bytes())?;
    read_line(&mut p)
}

fn read_line(r: &mut dyn Read) -> std::io::Result<String> {
    let mut out = Vec::new();
    let mut buf = [0u8; 1024];
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            break;
        }
        out.extend_from_slice(&buf[..n]);
        if out.contains(&b'\n') || out.len() > 64 * 1024 {
            break;
        }
    }
    Ok(String::from_utf8_lossy(&out).into_owned())
}

/// Ask the engine, bounded by `ANSWER_TIMEOUT`. A hung engine costs the
/// timeout, never the turn.
fn via_engine(addr: String, line: String) -> bool {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(exchange(&addr, &line).map(|a| acknowledged(&a)).unwrap_or(false));
    });
    rx.recv_timeout(ANSWER_TIMEOUT).unwrap_or(false)
}

fn run_cli(args: &[String], input: &[u8]) {
    let (prog, rest) = match args.split_first() {
        Some((p, r)) => (p.clone(), r.to_vec()),
        None => ("agent-switch".to_string(), vec!["__hook-event".to_string()]),
    };
    let spawn = |cmd: &mut Command| -> bool {
        match cmd.stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null()).spawn() {
            Ok(mut child) => {
                if let Some(mut si) = child.stdin.take() {
                    let _ = si.write_all(input);
                }
                let _ = child.wait();
                true
            }
            Err(_) => false,
        }
    };
    if !spawn(Command::new(&prog).args(&rest)) && cfg!(windows) {
        // An npm shim on Windows is a .cmd file, which only cmd starts.
        spawn(Command::new("cmd").arg("/C").arg(&prog).args(&rest));
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let mut input = Vec::new();
    let _ = std::io::stdin().take(MAX_PAYLOAD as u64 + 1).read_to_end(&mut input);
    if input.len() > MAX_PAYLOAD {
        // Too large for one request line: let the CLI read all of it.
        let _ = std::io::stdin().read_to_end(&mut input);
        return run_cli(&args, &input);
    }
    let get = |k: &str| std::env::var(k).ok();
    let env: Vec<(&str, String)> = ENV_KEYS.iter().filter_map(|k| get(k).map(|v| (*k, v))).collect();
    let text = String::from_utf8_lossy(&input).into_owned();
    let stored = !text.trim().is_empty()
        && address(cfg!(windows), &get).map(|a| via_engine(a, request_line(&text, &env))).unwrap_or(false);
    if !stored {
        run_cli(&args, &input);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn env(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<String> {
        move |k| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| v.to_string())
    }

    #[test]
    fn escapes_control_characters_and_quotes() {
        assert_eq!(json_string("a\"b\\c\n\u{1}"), "\"a\\\"b\\\\c\\n\\u0001\"");
        assert_eq!(json_string("Grüße"), "\"Grüße\"");
    }

    #[test]
    fn builds_one_line_with_payload_passed_through() {
        let l = request_line(" {\"hook_event_name\":\"Stop\"}\n", &[("CLAUDE_CONFIG_DIR", "/x/\"y\"".into())]);
        assert!(l.ends_with('\n') && l.matches('\n').count() == 1);
        assert_eq!(l, "{\"id\":1,\"op\":\"hook\",\"params\":{\"payload\":{\"hook_event_name\":\"Stop\"},\"env\":{\"CLAUDE_CONFIG_DIR\":\"/x/\\\"y\\\"\"}}}\n");
    }

    #[test]
    fn acknowledges_only_a_stored_answer() {
        assert!(acknowledged("{\"id\":1,\"ok\":true,\"result\":{\"stored\":true,\"indexed\":true}}\n"));
        assert!(!acknowledged("{\"id\":1,\"ok\":true,\"result\":{\"stored\":false,\"reason\":\"no account\"}}"));
        assert!(!acknowledged("{\"id\":null,\"ok\":false,\"error\":{\"code\":\"bad_json\"}}"));
        assert!(!acknowledged(""));
    }

    #[test]
    fn address_follows_the_engine() {
        assert_eq!(address(false, &env(&[("AGENT_SWITCH_HOME", "/r/")])).unwrap(), "/r/engine.sock");
        assert_eq!(address(false, &env(&[("HOME", "/home/u")])).unwrap(), "/home/u/.agent-switch/engine.sock");
        assert_eq!(address(true, &env(&[("USERNAME", "Max M")])).unwrap(), "\\\\.\\pipe\\agent-switch-Max_M");
        assert!(address(false, &env(&[])).is_none());
    }
}
