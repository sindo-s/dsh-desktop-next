use crate::{Host,cmd,run,migration::digest};
use std::path::PathBuf;
use serde_json::{json,Value};
use tauri::Manager;
pub fn image(app:&tauri::AppHandle)->Result<Option<PathBuf>,String>{
    let expected=option_env!("DSH_ROOTFS_SHA256");
    let Some(expected)=expected else{return Ok(None)};
    let file=app.path().resource_dir().map_err(|e|e.to_string())?.join("offline/rootfs.tar.gz");
    if digest(&file)?!=expected{return Err("离线镜像校验失败，拒绝导入".into());}Ok(Some(file))
}
pub fn packaged()->bool{option_env!("DSH_ROOTFS_SHA256").is_some()}
pub fn enable(app:&tauri::AppHandle,host:&Host)->Result<Value,String>{
    let Some(expected)=option_env!("DSH_WSL_SHA256") else{return Err("此在线版未包含 WSL 离线平台安装器".into())};
    let file=app.path().resource_dir().map_err(|e|e.to_string())?.join("offline/wsl.x64.msi");
    if digest(&file)?!=expected{return Err("WSL MSI checksum mismatch".into());}
    // MSI path is an application resource, never a renderer-supplied command.
    let msi=file.to_string_lossy().replace('\'',"''");
    let script=format!("$ErrorActionPreference='Stop'; $p=Start-Process msiexec.exe -ArgumentList @('/i','\"{msi}\"','/passive','/norestart') -Wait -PassThru; if($p.ExitCode -notin @(0,3010)){{exit $p.ExitCode}}; & dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart /LimitAccess; if($LASTEXITCODE -notin @(0,3010)){{exit $LASTEXITCODE}}; exit 0");
    use base64::Engine;
    let encoded=base64::engine::general_purpose::STANDARD.encode(script.encode_utf16().flat_map(u16::to_le_bytes).collect::<Vec<_>>());
    let launcher=format!("$p=Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -EncodedCommand {encoded}' -Wait -PassThru; exit $p.ExitCode");
    let mut command=cmd("powershell.exe");command.args(["-NoProfile","-NonInteractive","-Command",&launcher]);
    run(command,None,app,host,1815)?;Ok(json!({"rebootMayBeRequired":true}))
}
