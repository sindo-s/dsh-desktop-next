#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use serde_json::{json, Value};
use std::{fs, io::{BufRead, BufReader, Write}, path::PathBuf, process::{Command, Stdio}, sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}}, time::{Duration, Instant}};
use tauri::{Emitter, Manager};
mod migration;
mod updates;
mod offline;
#[cfg(windows)]
use std::os::windows::process::CommandExt;

const DISTRO: &str = "DSH-Desktop-Next";
const LINUX: &str = include_str!("../../runtime/manager.mjs");
const BOOT: &str = include_str!("../../runtime/bootstrap.sh");
#[derive(Clone)]
struct Host { busy: Arc<AtomicBool>, job: Arc<Mutex<Value>>, state_dir: PathBuf }
impl Host {
    fn update(&self, app: &tauri::AppHandle, value: Value) {
        *self.job.lock().unwrap() = value.clone();
        let file = self.state_dir.join("job.json");
        // Small diagnostic journal, separate from authoritative Linux slot state.
        let _ = fs::write(file, value.to_string());
        let _ = app.emit("host-job", value);
    }
}
fn cmd(binary: &str) -> Command {
    let mut command = Command::new(binary);
    #[cfg(windows)] command.creation_flags(0x08000000);
    command
}
fn decode(bytes: &[u8]) -> String {
    if bytes.iter().take(100).filter(|b| **b == 0).count() > 5 {
        String::from_utf16_lossy(&bytes.chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect::<Vec<_>>())
    } else { String::from_utf8_lossy(bytes).into_owned() }
}
fn registered() -> Result<bool, String> {
    let output = cmd("wsl.exe").args(["--list", "--quiet"]).output().map_err(|e| e.to_string())?;
    if !output.status.success() { return Err(format!("WSL unavailable: {}", decode(&output.stdout))); }
    Ok(decode(&output.stdout).lines().any(|s| s.trim() == DISTRO))
}
fn run(mut command: Command, input: Option<&str>, app: &tauri::AppHandle, host: &Host, seconds: u64) -> Result<Value, String> {
    command.stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| e.to_string())?;
    if let Some(text) = input { child.stdin.take().unwrap().write_all(text.as_bytes()).map_err(|e| e.to_string())?; }
    let stdout = child.stdout.take().unwrap(); let stderr = child.stderr.take().unwrap();
    let capture = Arc::new(Mutex::new(String::new()));
    let last = Arc::new(Mutex::new(Value::Null));
    let mut readers = vec![];
    for pipe in [Box::new(stdout) as Box<dyn std::io::Read + Send>, Box::new(stderr)] {
        let capture = capture.clone(); let last = last.clone(); let app = app.clone(); let host = host.clone();
        readers.push(std::thread::spawn(move || {
            for bytes in BufReader::new(pipe).split(b'\n').map_while(Result::ok) {
                let line = decode(&bytes).replace('\0', "");
                if let Ok(value) = serde_json::from_str::<Value>(&line) {
                    if value.get("phase").is_some() { host.update(&app, json!({"status":"running","message":value["phase"]})); }
                    if value.get("result").is_some() || value.get("error").is_some() { *last.lock().unwrap() = value; }
                }
                let mut text = capture.lock().unwrap(); text.push_str(&line); text.push('\n');
                if text.len() > 32000 { let mut from = text.len() - 16000; while !text.is_char_boundary(from) { from += 1; } *text = text[from..].to_string(); }
            }
        }));
    }
    let deadline = Instant::now() + Duration::from_secs(seconds);
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { break status; }
        if Instant::now() > deadline { let _ = child.kill(); return Err("Host operation timed out. Retry to inspect persisted Linux state.".into()); }
        std::thread::sleep(Duration::from_millis(100));
    };
    for reader in readers { let _ = reader.join(); }
    let value = last.lock().unwrap().clone();
    if let Some(error) = value.get("error") { return Err(error.as_str().unwrap_or("Runtime error").to_string()); }
    if !status.success() { return Err(format!("Command failed ({status}). Another operation may still hold the WSL lock.\n{}", capture.lock().unwrap())); }
    Ok(value.get("result").cloned().unwrap_or(json!({"ok":true})))
}
fn linux_action(action: &str, version: &str, app: &tauri::AppHandle, host: &Host) -> Result<Value, String> {
    let mut command = cmd("wsl.exe");
    command.args(["-d", DISTRO, "-u", "dsh", "--exec", "timeout", "--kill-after=5s", "1800s", "flock", "-n", "/home/dsh/.local/share/dsh-next/operation.lock", "/usr/local/bin/node", "--input-type=module", "-", action, version]);
    run(command, Some(LINUX), app, host, 1815)
}
fn validate_root(root: &str) -> Result<(), String> {
    let bytes = root.as_bytes();
    if bytes.len() < 5 || !bytes[0].is_ascii_alphabetic() || bytes[1] != b':' || bytes[2] != b'\\' || root.contains(['\n', '\r', '\0', '"', '%']) || root.split('\\').any(|p| p == ".." || p == ".") { return Err("请选择磁盘下的独立目录，例如 D:\\DSH-Next".into()); }
    Ok(())
}
fn resume_registration(enable:bool)->Result<(),String>{
    let mut c=cmd("reg.exe");let key="HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\RunOnce";
    if enable{
        let exe=std::env::current_exe().map_err(|e|e.to_string())?;
        c.args(["add",key,"/v","DshNextResume","/t","REG_SZ","/d",&format!("\"{}\" --resume-setup",exe.to_string_lossy()),"/f"]);
    }else{c.args(["delete",key,"/v","DshNextResume","/f"]);}
    let result=c.output().map_err(|e|e.to_string())?;if enable&&!result.status.success(){return Err("无法注册重启后续装".into());}Ok(())
}
fn setup(root: &str, app: &tauri::AppHandle, host: &Host) -> Result<Value, String> {
    validate_root(root)?;
    let record = host.state_dir.join("installation.json");
    let existing = registered().unwrap_or(false);
    if existing && !record.exists() {
        let marker = cmd("wsl.exe").args(["-d", DISTRO, "-u", "root", "--exec", "cat", "/etc/dsh-next-owned"]).output().map_err(|e| e.to_string())?;
        if !marker.status.success() || decode(&marker.stdout).trim() != "dsh-desktop-next/v1" { return Err("DSH-Desktop-Next already exists but is not owned by this application. Refusing to modify it.".into()); }
    }
    if existing && record.exists() {
        let saved: Value = serde_json::from_slice(&fs::read(&record).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        if saved["root"].as_str() != Some(root) { return Err("已有环境位于另一个目录。此操作不支持移动发行版，请使用原安装目录。".into()); }
    }
    if !existing {
        let destination = PathBuf::from(root).join("wsl");
        if destination.exists() { return Err("WSL destination already exists. Select a new empty application directory.".into()); }
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        fs::write(&record, json!({"root":root,"phase":"installing"}).to_string()).map_err(|e| e.to_string())?;
        resume_registration(true)?;
        host.update(app, json!({"status":"running","message":"安装专用 Ubuntu 到所选目录；首次启用 WSL 可能需要重启"}));
        let mut command = cmd("wsl.exe");
        if let Some(image)=offline::image(app)?{
            command.args(["--import",DISTRO,destination.to_str().unwrap(),image.to_str().unwrap(),"--version","2"]);
        }else{command.args(["--install", "Ubuntu-24.04", "--name", DISTRO, "--location", destination.to_str().unwrap(), "--no-launch"]);}
        run(command, None, app, host, 1815)?;
        if !registered()? { return Err("WSL installation is incomplete. Restart Windows if requested, then resume setup.".into()); }
    }
    host.update(app, json!({"status":"running","message":"准备 Node.js、Git、构建依赖及沙箱"}));
    let mut command = cmd("wsl.exe");
    command.args(["-d", DISTRO, "-u", "root", "--exec", "timeout", "--kill-after=5s", "1800s", "bash", "-s"]);
    if offline::packaged(){
        let mut verify=cmd("wsl.exe");verify.args(["-d",DISTRO,"-u","dsh","--exec","bwrap","--ro-bind","/","/","--dev","/dev","--proc","/proc","--die-with-parent","--","true"]);
        run(verify,None,app,host,30)?;
    }else{run(command, Some(BOOT), app, host, 1815)?;}
    fs::write(record, json!({"root":root,"phase":"ready"}).to_string()).map_err(|e| e.to_string())?;
    let status = linux_action("status", "", app, host)?;
    if status["active"].is_null() {
        let latest = linux_action("check", "", app, host)?;
        let result=linux_action("install", latest["version"].as_str().ok_or("Missing official version")?, app, host)?;resume_registration(false)?;Ok(result)
    } else {resume_registration(false)?;Ok(status)}
}
fn authorize(window: &tauri::Webview) -> Result<(), String> {
    if window.label() != "main" { return Err("Native host API is restricted to the local management window".into()); }
    Ok(())
}
#[tauri::command]
fn get_job(window: tauri::Webview, host: tauri::State<Host>) -> Result<Value, String> { authorize(&window)?; Ok(host.job.lock().unwrap().clone()) }
#[tauri::command]
async fn choose_directory(window:tauri::Webview,app:tauri::AppHandle)->Result<Option<String>,String>{
    authorize(&window)?;
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move||app.dialog().file().blocking_pick_folder().map(|p|p.to_string())).await.map_err(|e|e.to_string())
}
#[tauri::command]
async fn run_action(window: tauri::Webview, app: tauri::AppHandle, host: tauri::State<'_, Host>, action: String, value: Option<String>) -> Result<Value, String> {
    authorize(&window)?;
    if !["inspect","enable-wsl","setup","status","check","install","start","stop","rollback","plugin-list","plugin-add","plugin-remove","legacy-inspect","legacy-import","storage","cleanup"].contains(&action.as_str()) { return Err("Unknown action".into()); }
    if host.busy.swap(true, Ordering::SeqCst) { return Err("已有操作正在进行".into()); }
    let host = host.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        host.update(&app, json!({"status":"running","message":action}));
        let result = if action == "inspect" {
            let config:Value=fs::read(host.state_dir.join("installation.json")).ok().and_then(|v|serde_json::from_slice(&v).ok()).unwrap_or(json!({}));
            let updates:Value=fs::read(host.state_dir.join("update-source.json")).ok().and_then(|v|serde_json::from_slice(&v).ok()).unwrap_or(json!({}));
            registered().map(|ready| json!({"registered":ready,"root":config["root"],"updateRepo":updates["repo"],"offline":offline::packaged(),"resume":std::env::args().any(|a|a=="--resume-setup")}))
        }
        else if action=="legacy-inspect" {migration::inspect(&app)}
        else if action=="legacy-import" {migration::import(&app,&host)}
        else if action == "enable-wsl" {
            if offline::packaged(){offline::enable(&app,&host)}else{
            let mut command = cmd("powershell.exe");
            command.args(["-NoProfile", "-NonInteractive", "-Command", "$p = Start-Process wsl.exe -ArgumentList '--install --no-distribution --no-launch' -Verb RunAs -WindowStyle Hidden -PassThru -Wait; exit $p.ExitCode"]);
            run(command, None, &app, &host, 1815)
            }
        }
        else if action == "setup" { setup(value.as_deref().unwrap_or("D:\\DSH-Next"), &app, &host) }
        else { linux_action(&action, value.as_deref().unwrap_or(""), &app, &host) };
        match &result {
            Ok(_) => host.update(&app, json!({"status":"succeeded","message":format!("{} 完成",action)})),
            Err(error) => host.update(&app, json!({"status":"failed","message":error})),
        }
        host.busy.store(false, Ordering::SeqCst); result
    }).await.map_err(|e| e.to_string())?
}
#[tauri::command]
async fn open_core(window: tauri::Webview, app: tauri::AppHandle, host: tauri::State<'_, Host>) -> Result<(), String> {
    authorize(&window)?;
    let h = host.inner().clone(); let a = app.clone();
    let state = tauri::async_runtime::spawn_blocking(move || linux_action("status", "", &a, &h)).await.map_err(|e| e.to_string())??;
    let url = state["url"].as_str().ok_or("请先启动内核")?;
    let parsed: tauri::Url = url.parse().map_err(|_| "Invalid URL")?;
    if parsed.scheme() != "http" || parsed.host_str() != Some("127.0.0.1") { return Err("Unexpected core address".into()); }
    let addr = format!("127.0.0.1:{}", parsed.port().ok_or("Missing port")?).parse().map_err(|_| "Invalid port")?;
    std::net::TcpStream::connect_timeout(&addr, Duration::from_secs(3)).map_err(|e| format!("Windows 无法访问 WSL 服务：{e}"))?;
    if let Some(core) = app.get_webview("core") {
        if core.url().map_err(|e|e.to_string())?.origin()==parsed.origin() {
            fit_core(&app)?;core.show().map_err(|e|e.to_string())?;return core.set_focus().map_err(|e|e.to_string());
        }
        core.close().map_err(|e| e.to_string())?;
    }
    let allowed = parsed.origin().ascii_serialization();
    let parent=window.window();
    let size=parent.inner_size().map_err(|e|e.to_string())?.to_logical::<f64>(parent.scale_factor().map_err(|e|e.to_string())?);
    let builder=tauri::webview::WebviewBuilder::new("core", tauri::WebviewUrl::External(parsed))
        .on_navigation(move |url| url.origin().ascii_serialization() == allowed)
        .on_new_window(|_,_|tauri::webview::NewWindowResponse::Deny);
    let core=parent.add_child(builder,tauri::LogicalPosition::new(0.0,56.0),tauri::LogicalSize::new(size.width,(size.height-56.0).max(1.0))).map_err(|e|e.to_string())?;
    core.set_focus().map_err(|e|e.to_string())?;
    Ok(())
}
fn fit_core(app:&tauri::AppHandle)->Result<(),String>{
    if let Some(core)=app.get_webview("core") {
        let parent=core.window();
        let size=parent.inner_size().map_err(|e|e.to_string())?.to_logical::<f64>(parent.scale_factor().map_err(|e|e.to_string())?);
        core.set_bounds(tauri::Rect{position:tauri::LogicalPosition::new(0.0,56.0).into(),size:tauri::LogicalSize::new(size.width,(size.height-56.0).max(1.0)).into()}).map_err(|e|e.to_string())?;
    }Ok(())
}
#[tauri::command]
async fn hide_core(window:tauri::Webview,app:tauri::AppHandle)->Result<(),String>{
    authorize(&window)?;
    if let Some(core)=app.get_webview("core"){core.hide().map_err(|e|e.to_string())?;}
    window.set_focus().map_err(|e|e.to_string())
}
fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_single_instance::init(|app, _, _| { if let Some(w) = app.get_window("main") { let _ = w.show();let _ = w.set_focus(); } }))
        .on_window_event(|window,event|{if matches!(event,tauri::WindowEvent::Resized(_)|tauri::WindowEvent::ScaleFactorChanged{..}){let _=fit_core(window.app_handle());}})
        .setup(|app| {
            let state_dir = app.path().app_data_dir()?; fs::create_dir_all(&state_dir)?;
            let mut job: Value = fs::read(state_dir.join("job.json")).ok().and_then(|s| serde_json::from_slice(&s).ok()).unwrap_or(json!({"status":"idle","message":"准备就绪"}));
            if job["status"] == "running" { job = json!({"status":"interrupted","message":"上次任务中断。请刷新状态后继续；不会自动覆盖现有内核。"}); }
            if job["status"]=="installing" {job=if job["targetVersion"].as_str()==Some(app.package_info().version.to_string().as_str()){json!({"status":"succeeded","message":"桌面更新完成，已运行目标版本"})}else{json!({"status":"interrupted","message":"上次桌面更新未切换到目标版本，请重新检查更新"})};}
            app.manage(updates::Pending(Mutex::new(None)));
            app.manage(Host { busy: Arc::new(AtomicBool::new(false)), job: Arc::new(Mutex::new(job)), state_dir });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![run_action, get_job, open_core,hide_core,choose_directory,updates::desktop_update])
        .run(tauri::generate_context!()).expect("desktop runtime");
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn root_validation() {
        for good in ["D:\\DSH-Next", "D:\\Apps\\DSH Next"] { assert!(validate_root(good).is_ok()); }
        for bad in ["D:\\", "relative", "D:\\..\\Windows", "D:\\x\nother"] { assert!(validate_root(bad).is_err()); }
    }
    #[test] fn utf16_wsl_output() { assert_eq!(decode(&"DSH-Desktop-Next\r\n".encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>()), "DSH-Desktop-Next\r\n"); }
}
