//! WhereInTheWorld native layer.
//!
//! The map itself is a web page (../src). This side only does what a web page
//! can't: HTTP requests to Tautulli and GitHub without CORS restrictions
//! (optionally accepting self-signed certificates), keeping the screen awake,
//! and starting full screen when launched with `--kiosk`.

use std::time::Duration;

use serde::Serialize;
#[cfg(desktop)]
use tauri::Manager;
use tauri::{ipc::Response, State};

struct Http {
    secure: reqwest::Client,
    insecure: reqwest::Client,
}

fn client(accept_invalid_certs: bool) -> reqwest::Client {
    reqwest::Client::builder()
        .user_agent(concat!("WhereInTheWorld/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(20))
        .danger_accept_invalid_certs(accept_invalid_certs)
        .build()
        .expect("failed to build HTTP client")
}

/// Error text without the URL (it can contain the Tautulli API key).
fn describe(e: reqwest::Error) -> String {
    let e = e.without_url();
    let mut msg = if e.is_timeout() {
        "timed out".to_string()
    } else if e.is_connect() {
        "could not connect".to_string()
    } else {
        e.to_string()
    };
    let mut src = std::error::Error::source(&e);
    while let Some(s) = src {
        let t = s.to_string();
        if !msg.contains(&t) {
            msg.push_str(": ");
            msg.push_str(&t);
        }
        src = s.source();
    }
    msg
}

async fn send(http: &Http, url: &str, insecure: bool) -> Result<reqwest::Response, String> {
    let c = if insecure { &http.insecure } else { &http.secure };
    c.get(url).send().await.map_err(describe)
}

#[derive(Serialize)]
struct TextResponse {
    status: u16,
    body: String,
}

/// GET a URL and return its status and body as text (any status).
#[tauri::command]
async fn http_text(http: State<'_, Http>, url: String, insecure: bool) -> Result<TextResponse, String> {
    let r = send(&http, &url, insecure).await?;
    let status = r.status().as_u16();
    let body = r.text().await.map_err(describe)?;
    Ok(TextResponse { status, body })
}

/// GET a URL and return the raw bytes (images). Non-2xx is an error.
#[tauri::command]
async fn http_bytes(http: State<'_, Http>, url: String, insecure: bool) -> Result<Response, String> {
    let r = send(&http, &url, insecure).await?;
    if !r.status().is_success() {
        return Err(format!("HTTP {}", r.status().as_u16()));
    }
    let bytes = r.bytes().await.map_err(describe)?;
    Ok(Response::new(bytes.to_vec()))
}

#[cfg(windows)]
fn keep_awake() {
    use windows_sys::Win32::System::Power::{
        SetThreadExecutionState, ES_CONTINUOUS, ES_DISPLAY_REQUIRED, ES_SYSTEM_REQUIRED,
    };
    // Lasts for as long as the main thread runs, i.e. while WhereInTheWorld is open.
    unsafe {
        SetThreadExecutionState(ES_CONTINUOUS | ES_DISPLAY_REQUIRED | ES_SYSTEM_REQUIRED);
    }
}

#[cfg(not(windows))]
fn keep_awake() {
    // Android: handled in MainActivity (FLAG_KEEP_SCREEN_ON).
    // Linux kiosk: the X session disables blanking (kiosk/xinitrc).
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Http { secure: client(false), insecure: client(true) })
        .setup(|app| {
            keep_awake();
            #[cfg(desktop)]
            if std::env::args().any(|a| a == "--kiosk" || a == "--fullscreen") {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_fullscreen(true);
                }
            }
            #[cfg(mobile)]
            let _ = app;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![http_text, http_bytes])
        .run(tauri::generate_context!())
        .expect("error while running WhereInTheWorld");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fetches_over_https_and_hides_urls_in_errors() {
        tauri::async_runtime::block_on(async {
            let http = Http { secure: client(false), insecure: client(true) };
            let r = send(&http, "https://api.github.com/repos/tauri-apps/tauri/releases/latest", false).await.unwrap();
            assert!(r.status().is_success());
            let err = send(&http, "http://127.0.0.1:9/api/v2?apikey=SECRET", false).await.unwrap_err();
            assert!(!err.contains("SECRET"), "error leaked the URL: {err}");
        });
    }
}
