use std::sync::Mutex;
use serde_json::{json,Value};
use tauri::Emitter;
use tauri_plugin_updater::{Update,UpdaterExt};
use crate::{Host,authorize};
pub struct Pending(pub Mutex<Option<Update>>);
pub fn endpoint(repo:&str)->Result<tauri::Url,String>{
    let parts:Vec<_>=repo.split('/').collect();
    if parts.len()!=2||parts.iter().any(|p|p.is_empty()||p.starts_with('.')||!p.chars().all(|c|c.is_ascii_alphanumeric()||"._-".contains(c))){return Err("请输入 GitHub owner/repo".into());}
    format!("https://github.com/{repo}/releases/latest/download/latest.json").parse().map_err(|e|format!("{e}"))
}
#[tauri::command]
pub async fn desktop_update(window:tauri::Webview,app:tauri::AppHandle,host:tauri::State<'_,Host>,pending:tauri::State<'_,Pending>,action:String,repo:String)->Result<Value,String>{
    authorize(&window)?;
    if host.busy.swap(true,std::sync::atomic::Ordering::SeqCst){return Err("已有操作正在进行".into());}
    let result=async {
        if action=="check" {
            *pending.0.lock().unwrap()=None;
            let url=endpoint(&repo)?;
            host.update(&app,json!({"status":"running","message":"检查桌面签名更新"}));
            let update=app.updater_builder().pubkey(include_str!("../update.pub").trim()).endpoints(vec![url]).map_err(|e|e.to_string())?.timeout(std::time::Duration::from_secs(30)).build().map_err(|e|e.to_string())?.check().await.map_err(|e|e.to_string())?;
            std::fs::write(host.state_dir.join("update-source.json"),json!({"repo":repo}).to_string()).map_err(|e|e.to_string())?;
            let result=update.as_ref().map(|u|json!({"available":true,"version":u.version,"currentVersion":u.current_version})).unwrap_or(json!({"available":false}));
            *pending.0.lock().unwrap()=update;Ok(result)
        } else if action=="install" {
            let update=pending.0.lock().unwrap().take().ok_or("请先检查更新")?;
            host.update(&app,json!({"status":"running","message":"下载并验证桌面更新签名"}));
            let mut downloaded=0u64;let mut reported=0u64;
            let data=update.download(|size,total|{
                downloaded+=size as u64;
                if downloaded-reported>=1024*1024 {reported=downloaded;let _=app.emit("host-job",json!({"status":"running","message":format!("已下载 {} MiB / {:?}",downloaded/1024/1024,total.map(|n|n/1024/1024))}));}
            },||{}).await.map_err(|e|e.to_string())?;
            host.update(&app,json!({"status":"installing","targetVersion":update.version,"message":"签名验证通过，正在启动安装器；桌面将退出，WSL 内核保持运行"}));
            update.install(data).map_err(|e|e.to_string())?;
            Ok(json!({"installing":true}))
        } else {Err("Unknown desktop update action".into())}
    }.await;
    host.busy.store(false,std::sync::atomic::Ordering::SeqCst);
    match &result {Ok(_)=>host.update(&app,json!({"status":"succeeded","message":"桌面更新操作完成"})),Err(e)=>host.update(&app,json!({"status":"failed","message":e}))};
    result
}
#[cfg(test)]mod tests{use super::*;#[test]fn repository_validation(){assert!(endpoint("owner/repo").is_ok());for p in ["http://evil","../a","a/b/c","a/b?x"]{assert!(endpoint(p).is_err());}}}
