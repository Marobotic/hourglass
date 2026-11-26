// Hourglass's window. The Node service (hourglassd) owns the data, alarms and sync; this is only the window
// onto it. The service normally starts the window as its child with --port and --token. Started on its own
// (a dev run, a Linux launcher), the window reads the token file and starts the service when it isn't up.
// The service also starts it with --hidden at sign-in, so opening Hourglass later only shows a window that
// is already loaded; the Start menu runs this exe, and a second copy hands over to the first and exits.
use std::{
    io::{Read, Write},
    net::{SocketAddr, TcpStream},
    path::PathBuf,
    process::{Command, Stdio},
    time::Duration,
};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_window_state::StateFlags;

#[derive(Clone, serde::Serialize)]
struct Boot {
    port: u16,
    token: String,
    started_service: bool,
    dev: Option<String>,
    hidden: bool,
}

fn arg(name: &str) -> Option<String> {
    let args: Vec<String> = std::env::args().collect();
    args.iter().position(|a| a == name).and_then(|i| args.get(i + 1).cloned())
}

fn flag(name: &str) -> bool { std::env::args().any(|a| a == name) }

fn config_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("HOURGLASS_CONFIG") { return PathBuf::from(dir); }
    if cfg!(windows) {
        PathBuf::from(std::env::var("APPDATA").unwrap_or_default()).join("Hourglass")
    } else {
        PathBuf::from(std::env::var("HOME").unwrap_or_default()).join(".config/hourglass")
    }
}

fn read_token() -> String {
    std::fs::read_to_string(config_dir().join("token")).map(|t| t.trim().to_string()).unwrap_or_default()
}

fn service_up(port: u16) -> bool {
    TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(400)).is_ok()
}

// The install folder holds the window in window\ and the service in sidecar\ with its node next to it.
fn start_service() -> bool {
    let Ok(exe) = std::env::current_exe() else { return false };
    let Some(dir) = exe.parent() else { return false };
    for root in [dir.to_path_buf(), dir.join(".."), dir.join("../..")] {
        let script = root.join("sidecar").join("hourglassd.js");
        if !script.exists() { continue; }
        let nodes = [root.join("node").join("hourglassd.exe"), root.join("node").join("node.exe"), PathBuf::from("node")];
        for node in nodes {
            if node.components().count() > 1 && !node.exists() { continue; }
            let mut cmd = Command::new(&node);
            cmd.arg(&script).current_dir(&root).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            }
            if cmd.spawn().is_ok() { return true; }
        }
    }
    false
}

// Quit from the tray ends the service too, as the old window did (POST /api/quit).
fn quit_service(port: u16, token: &str) {
    let Ok(mut s) = TcpStream::connect_timeout(&SocketAddr::from(([127, 0, 0, 1], port)), Duration::from_millis(800)) else { return };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let req = format!(
        "POST /api/quit HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nAuthorization: Bearer {token}\r\nContent-Type: application/json\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}"
    );
    if s.write_all(req.as_bytes()).is_ok() {
        let mut buf = [0u8; 256];
        let _ = s.read(&mut buf);
    }
}

fn show(app: &tauri::AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// If the page's web process dies, WebKit leaves an empty (black) window. The first time, Hourglass starts
// again with WebKit's DMA-BUF renderer off: on NVIDIA, once the driver can no longer hand out GPU channels
// (kernel log "KernelChannelGroupApi alloc RPC ... failed"), every new web process crashes in
// libnvidia-eglcore when that renderer starts, while the other renderer still draws (WebKitGTK 2.54, driver
// 620). The renderer is picked when WebKit starts, so changing it needs a fresh process. After that, the page
// is loaded again, at most three times a minute, so a page that cannot run doesn't restart forever.
#[cfg(target_os = "linux")]
fn keep_page_alive(window: &tauri::WebviewWindow) {
    let app = window.app_handle().clone();
    let win = window.clone();
    let _ = window.with_webview(move |webview| {
        use webkit2gtk::WebViewExt;
        let deaths = std::rc::Rc::new(std::cell::RefCell::new(Vec::<std::time::Instant>::new()));
        webview.inner().connect_web_process_terminated(move |view, reason| {
            if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
                eprintln!("hourglass: the page's web process ended ({reason:?}); starting again without WebKit's DMA-BUF renderer");
                std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
                // Same arguments, except that a window already on screen comes back on screen.
                let visible = win.is_visible().unwrap_or(false);
                let args: Vec<String> = std::env::args().skip(1).filter(|a| !(visible && a == "--hidden")).collect();
                app.cleanup_before_exit(); // lets go of the single-instance name first
                if let Ok(exe) = std::env::current_exe() {
                    let _ = Command::new(exe).args(args).spawn();
                }
                std::process::exit(0);
            }
            let mut d = deaths.borrow_mut();
            d.retain(|t| t.elapsed() < Duration::from_secs(60));
            d.push(std::time::Instant::now());
            eprintln!("hourglass: the page's web process ended ({reason:?}); {}", if d.len() <= 3 { "loading it again" } else { "giving up" });
            if d.len() <= 3 { view.reload(); }
        });
    });
}

#[tauri::command]
fn boot(state: tauri::State<'_, Boot>) -> Boot { state.inner().clone() }

#[tauri::command]
fn show_window(app: tauri::AppHandle) { show(&app); }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let port: u16 = arg("--port").and_then(|p| p.parse().ok()).unwrap_or(8931);
    let token = arg("--token").unwrap_or_else(read_token);
    let started_service = !service_up(port) && start_service();
    let boot_state = Boot { port, token: token.clone(), started_service, dev: arg("--dev"), hidden: flag("--hidden") };
    // Handed to the page before its scripts run, so it draws without a round trip to ask for it.
    let boot_script = format!("window.__HG_BOOT = {};", serde_json::to_string(&boot_state).unwrap_or_else(|_| "null".into()));
    #[cfg(target_os = "linux")]
    let show_when_loaded = !boot_state.hidden;
    #[cfg(target_os = "linux")]
    let shown_once = std::sync::atomic::AtomicBool::new(false);

    tauri::Builder::default()
        // Another start (the Start menu, the service) shows this window; the service's
        // --hidden warm-up start leaves it in the tray.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if !args.iter().any(|a| a == "--hidden") { show(app); }
        }))
        // Size and place come back; whether it was showing does not (the page shows it once drawn).
        .plugin(tauri_plugin_window_state::Builder::default().with_state_flags(StateFlags::all() & !StateFlags::VISIBLE).build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(boot_state)
        .invoke_handler(tauri::generate_handler![boot, show_window])
        .setup(move |app| {
            let builder = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                .title("Hourglass")
                // No native title bar: the page draws its own minimize / maximize / close (ui/window.js).
                .decorations(false)
                .inner_size(1240.0, 820.0)
                .min_inner_size(720.0, 520.0)
                .background_color(Color(18, 18, 18, 255))
                .visible(false)
                .additional_browser_args("--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection")
                .initialization_script(&boot_script);
            // WebKitGTK runs no animation frames for a window that has never been mapped, so the page's own
            // "show me once drawn" (a requestAnimationFrame in app.js) can wait forever and Hourglass never
            // appears. On Linux the window shows itself when the page first finishes loading instead; the
            // --hidden warm-up start still stays in the tray, and later reloads don't pop it up.
            #[cfg(target_os = "linux")]
            let builder = builder.on_page_load(move |window, payload| {
                if show_when_loaded
                    && payload.event() == tauri::webview::PageLoadEvent::Finished
                    && !shown_once.swap(true, std::sync::atomic::Ordering::SeqCst)
                {
                    show(window.app_handle());
                }
            });
            let _window = builder.build()?;
            #[cfg(target_os = "linux")]
            keep_page_alive(&_window);
            let show_item = MenuItem::with_id(app, "show", "Show Hourglass", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit Hourglass", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let quit_token = token.clone();
            TrayIconBuilder::with_id("tray")
                .icon(app.default_window_icon().cloned().expect("window icon"))
                .tooltip("Hourglass")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(move |app, e| match e.id.as_ref() {
                    "show" => show(app),
                    "quit" => {
                        quit_service(port, &quit_token);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, e| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = e {
                        show(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        // X hides to the tray: alarms, timers and sync keep running, and a ring brings the window back.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Hourglass");
}
